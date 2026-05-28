import secrets
import re
from datetime import datetime, timedelta

from flask import Blueprint, current_app, g, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

from app import db
from app.auth_utils import create_access_token, hash_token, jwt_required, revoke_current_token
from app.errors import error_response
from app.logging_utils import log_event
from app.mail_utils import send_email_code, send_password_reset_email, send_verification_email
from app.models import EmailVerificationCode, EmailVerificationToken, PasswordResetToken, User
from app.rate_limit import limiter
from app.validators import clean_string, get_json_body


auth_bp = Blueprint("auth", __name__, url_prefix="/api/user")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
EMAIL_CODE_PURPOSES = {"register", "reset_password"}


def _normalize_email(value):
    if value is None:
        return ""
    return str(value).strip().lower()


def _validate_password(password):
    if password is None:
        return "password is required"
    if not isinstance(password, str):
        return "password must be a string"
    if len(password) < 8:
        return "password must be at least 8 characters"
    if len(password) > 128:
        return "password must be at most 128 characters"
    return None


def _user_payload(user):
    access_token, expires_in = create_access_token(user)
    return {
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "email_verified": bool(user.email_verified),
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": expires_in,
    }


def _public_user_payload(user):
    return {
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "email_verified": bool(user.email_verified),
    }


def _new_raw_token():
    return secrets.token_urlsafe(32)


def _new_email_code():
    return f"{secrets.randbelow(1000000):06d}"


def _create_email_verification_token(user):
    raw_token = _new_raw_token()
    row = EmailVerificationToken(
        user_id=user.id,
        token_hash=hash_token(raw_token),
        expires_at=datetime.utcnow() + timedelta(seconds=current_app.config["EMAIL_VERIFICATION_TOKEN_SECONDS"]),
    )
    db.session.add(row)
    return raw_token


def _send_new_verification_email(user):
    token = _create_email_verification_token(user)
    db.session.flush()
    delivered = send_verification_email(user, token)
    return delivered


def _create_password_reset_token(user):
    raw_token = _new_raw_token()
    row = PasswordResetToken(
        user_id=user.id,
        token_hash=hash_token(raw_token),
        expires_at=datetime.utcnow() + timedelta(seconds=current_app.config["PASSWORD_RESET_TOKEN_SECONDS"]),
    )
    db.session.add(row)
    return raw_token


def _find_valid_token(model, raw_token):
    if not raw_token:
        return None
    row = model.query.filter_by(token_hash=hash_token(raw_token)).first()
    if not row or row.used_at is not None or row.expires_at <= datetime.utcnow():
        return None
    return row


def _latest_email_code(email, purpose):
    return (
        EmailVerificationCode.query
        .filter_by(email=email, purpose=purpose)
        .order_by(EmailVerificationCode.created_at.desc(), EmailVerificationCode.id.desc())
        .first()
    )


def _enforce_email_code_send_limits(email, purpose):
    now = datetime.utcnow()
    latest = _latest_email_code(email, purpose)
    if latest and latest.created_at:
        elapsed = (now - latest.created_at).total_seconds()
        wait_seconds = current_app.config["EMAIL_CODE_RESEND_SECONDS"] - int(elapsed)
        if wait_seconds > 0:
            return error_response(
                f"Please wait {wait_seconds} seconds before requesting another code.",
                429,
                code="email_code_too_frequent",
            )

    hour_ago = now - timedelta(hours=1)
    recent_count = (
        EmailVerificationCode.query
        .filter(
            EmailVerificationCode.email == email,
            EmailVerificationCode.purpose == purpose,
            EmailVerificationCode.created_at >= hour_ago,
        )
        .count()
    )
    if recent_count >= current_app.config["EMAIL_CODE_HOURLY_LIMIT"]:
        return error_response(
            "Too many verification codes requested. Please try again later.",
            429,
            code="email_code_hourly_limit",
        )

    return None


def _create_email_code(email, purpose):
    raw_code = _new_email_code()
    row = EmailVerificationCode(
        email=email,
        purpose=purpose,
        code_hash=hash_token(raw_code),
        expires_at=datetime.utcnow() + timedelta(seconds=current_app.config["EMAIL_CODE_EXPIRATION_SECONDS"]),
    )
    db.session.add(row)
    return raw_code


def _verify_email_code(email, purpose, code):
    row = _latest_email_code(email, purpose)
    if not row or row.used_at is not None or row.expires_at <= datetime.utcnow():
        return None, error_response("Verification code is invalid or expired.", 400, code="invalid_email_code")

    if row.attempt_count >= current_app.config["EMAIL_CODE_MAX_ATTEMPTS"]:
        return None, error_response("Too many wrong attempts. Please request a new code.", 429, code="email_code_attempt_limit")

    if row.code_hash != hash_token(code):
        row.attempt_count += 1
        db.session.commit()
        return None, error_response("Verification code is incorrect.", 400, code="incorrect_email_code")

    row.used_at = datetime.utcnow()
    return row, None


@auth_bp.route("/email/code", methods=["POST"])
@limiter.limit("10 per hour")
def request_email_code():
    data = get_json_body(request)
    email = _normalize_email(clean_string(data.get("email"), "email", required=True, max_length=255))
    purpose = clean_string(data.get("purpose"), "purpose", required=True, max_length=30)

    if not EMAIL_RE.match(email):
        return error_response("A valid email is required", 400, code="invalid_email")
    if purpose not in EMAIL_CODE_PURPOSES:
        return error_response("purpose must be register or reset_password", 400, code="invalid_purpose")

    if purpose == "register" and User.query.filter_by(email=email).first():
        return error_response("Email is already registered", 409, code="email_exists")

    # Do not reveal whether an email exists in the password-reset flow.
    if purpose == "reset_password" and not User.query.filter_by(email=email).first():
        return jsonify({"message": "If the email can receive a code, it has been sent."})

    limit_response = _enforce_email_code_send_limits(email, purpose)
    if limit_response:
        return limit_response

    code = _create_email_code(email, purpose)
    delivered = send_email_code(email, code, purpose)
    db.session.commit()
    log_event(
        current_app.logger,
        "email_code_requested",
        email=email,
        purpose=purpose,
        email_delivered=delivered,
    )
    return jsonify({
        "message": "Verification code sent",
        "email_delivery": "sent" if delivered else "logged",
        "resend_after": current_app.config["EMAIL_CODE_RESEND_SECONDS"],
        "expires_in": current_app.config["EMAIL_CODE_EXPIRATION_SECONDS"],
    })


@auth_bp.route("/register", methods=["POST"])
@limiter.limit("5 per minute")
def register():
    data = get_json_body(request)
    email = _normalize_email(clean_string(data.get("email"), "email", required=True, max_length=255))
    code = clean_string(data.get("code"), "code", required=True, min_length=6, max_length=6)
    password = data.get("password")
    username = clean_string(data.get("username"), "username", max_length=50)

    if not EMAIL_RE.match(email):
        return error_response("A valid email is required", 400, code="invalid_email")

    password_error = _validate_password(password)
    if password_error:
        return error_response(password_error, 400, code="invalid_password")

    if User.query.filter_by(email=email).first():
        log_event(current_app.logger, "user_register_conflict", level="warning", email=email)
        return error_response("Email is already registered", 409, code="email_exists")

    if username and User.query.filter_by(username=username).first():
        log_event(current_app.logger, "user_register_username_conflict", level="warning", username=username)
        return error_response("Username is already registered", 409, code="username_exists")

    _, code_error = _verify_email_code(email, "register", code)
    if code_error:
        return code_error

    user = User(
        email=email,
        username=username,
        password_hash=generate_password_hash(password),
        password="",
        email_verified=True,
        email_verified_at=datetime.utcnow(),
    )
    db.session.add(user)
    db.session.commit()

    log_event(
        current_app.logger,
        "user_registered",
        user_id=user.id,
        email=user.email,
    )
    return jsonify(_user_payload(user)), 201


@auth_bp.route("/login", methods=["POST"])
@limiter.limit("5 per minute")
def login():
    data = get_json_body(request)
    email = _normalize_email(clean_string(data.get("email"), "email", required=True, max_length=255))
    password = data.get("password")

    if not email or not password:
        return error_response("email and password are required", 400, code="missing_credentials")

    user = User.query.filter_by(email=email).first()
    if not user:
        log_event(current_app.logger, "user_login_failed", level="warning", email=email, reason="user_not_found")
        return error_response("Email or password is incorrect", 401, code="invalid_credentials")

    password_valid = bool(user.password_hash and check_password_hash(user.password_hash, password))

    if not password_valid and user.password and user.password == password:
        user.password_hash = generate_password_hash(password)
        user.password = None
        password_valid = True

    if password_valid and not user.email_verified:
        email_delivered = _send_new_verification_email(user)
        db.session.commit()
        log_event(
            current_app.logger,
            "user_login_blocked_unverified_email",
            level="warning",
            user_id=user.id,
            email=user.email,
            email_delivered=email_delivered,
        )
        return error_response(
            "Please verify your email before logging in. A new verification email has been sent.",
            403,
            code="email_not_verified",
        )

    if password_valid:
        db.session.commit()
        log_event(current_app.logger, "user_logged_in", user_id=user.id, email=user.email)
        return jsonify(_user_payload(user))

    log_event(current_app.logger, "user_login_failed", level="warning", user_id=user.id, email=user.email, reason="bad_password")
    return error_response("Email or password is incorrect", 401, code="invalid_credentials")


@auth_bp.route("/logout", methods=["POST"])
@jwt_required
def logout():
    revoke_current_token()
    db.session.commit()
    return jsonify({"message": "Logged out"})


@auth_bp.route("/email/verification", methods=["POST"])
@jwt_required
@limiter.limit("3 per minute")
def request_email_verification():
    user = g.current_user
    if user.email_verified:
        return jsonify({"message": "Email is already verified"})

    token = _create_email_verification_token(user)
    db.session.flush()
    email_delivered = send_verification_email(user, token)
    db.session.commit()
    log_event(
        current_app.logger,
        "verification_email_requested",
        user_id=user.id,
        email=user.email,
        email_delivered=email_delivered,
    )
    return jsonify({
        "message": "Verification email sent",
        "email_delivery": "sent" if email_delivered else "logged",
    })


@auth_bp.route("/email/verify", methods=["POST"])
@limiter.limit("10 per minute")
def verify_email():
    data = get_json_body(request)
    token = clean_string(data.get("token"), "token", required=True, max_length=255)
    row = _find_valid_token(EmailVerificationToken, token)
    if not row:
        return error_response("Verification token is invalid or expired", 400, code="invalid_verification_token")

    user = User.query.get(row.user_id)
    user.email_verified = True
    user.email_verified_at = datetime.utcnow()
    row.used_at = datetime.utcnow()
    db.session.commit()
    log_event(current_app.logger, "email_verified", user_id=user.id, email=user.email)
    return jsonify({"message": "Email verified"})


@auth_bp.route("/password/forgot", methods=["POST"])
@limiter.limit("5 per minute")
def forgot_password():
    data = get_json_body(request)
    email = _normalize_email(clean_string(data.get("email"), "email", required=True, max_length=255))
    user = User.query.filter_by(email=email).first()

    if user:
        token = _create_password_reset_token(user)
        db.session.commit()
        send_password_reset_email(user, token)
        log_event(current_app.logger, "password_reset_requested", user_id=user.id, email=user.email)

    return jsonify({"message": "If the email exists, a reset link has been sent"})


@auth_bp.route("/password/reset", methods=["POST"])
@limiter.limit("5 per minute")
def reset_password():
    data = get_json_body(request)
    email = _normalize_email(clean_string(data.get("email"), "email", required=True, max_length=255))
    code = clean_string(data.get("code"), "code", required=True, min_length=6, max_length=6)
    new_password = data.get("new_password")

    password_error = _validate_password(new_password)
    if password_error:
        return error_response(password_error, 400, code="invalid_password")

    user = User.query.filter_by(email=email).first()
    if not user:
        return error_response("Verification code is invalid or expired.", 400, code="invalid_email_code")

    _, code_error = _verify_email_code(email, "reset_password", code)
    if code_error:
        return code_error

    user.password_hash = generate_password_hash(new_password)
    user.password = None
    db.session.commit()
    log_event(current_app.logger, "password_reset_completed", user_id=user.id, email=user.email)
    return jsonify({"message": "Password reset completed"})


@auth_bp.route("/password/change", methods=["POST"])
@jwt_required
@limiter.limit("5 per minute")
def change_password():
    data = get_json_body(request)
    current_password = data.get("current_password")
    new_password = data.get("new_password")

    if not current_password:
        return error_response("current_password is required", 400, code="missing_current_password")

    user = g.current_user
    if not user.password_hash or not check_password_hash(user.password_hash, current_password):
        return error_response("Current password is incorrect", 401, code="invalid_current_password")

    password_error = _validate_password(new_password)
    if password_error:
        return error_response(password_error, 400, code="invalid_password")

    user.password_hash = generate_password_hash(new_password)
    user.password = None
    revoke_current_token()
    db.session.commit()
    log_event(current_app.logger, "password_changed", user_id=user.id, email=user.email)
    return jsonify({"message": "Password changed. Please log in again."})
