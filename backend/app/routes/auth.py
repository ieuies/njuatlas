import secrets
import re
from datetime import datetime, timedelta

from flask import Blueprint, current_app, g, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

from app import db
from app.auth_utils import create_access_token, hash_token, jwt_required, revoke_current_token
from app.errors import error_response
from app.logging_utils import log_event
from app.mail_utils import send_password_reset_email, send_verification_email
from app.models import EmailVerificationToken, PasswordResetToken, User
from app.rate_limit import limiter
from app.validators import clean_string, get_json_body


auth_bp = Blueprint("auth", __name__, url_prefix="/api/user")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


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


def _new_raw_token():
    return secrets.token_urlsafe(32)


def _create_email_verification_token(user):
    raw_token = _new_raw_token()
    row = EmailVerificationToken(
        user_id=user.id,
        token_hash=hash_token(raw_token),
        expires_at=datetime.utcnow() + timedelta(seconds=current_app.config["EMAIL_VERIFICATION_TOKEN_SECONDS"]),
    )
    db.session.add(row)
    return raw_token


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


@auth_bp.route("/register", methods=["POST"])
@limiter.limit("5 per minute")
def register():
    data = get_json_body(request)
    email = _normalize_email(clean_string(data.get("email"), "email", required=True, max_length=255))
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

    user = User(email=email, username=username, password_hash=generate_password_hash(password), password="")
    db.session.add(user)
    db.session.flush()
    verification_token = _create_email_verification_token(user)
    db.session.commit()

    send_verification_email(user, verification_token)
    log_event(current_app.logger, "user_registered", user_id=user.id, email=user.email)
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

    if user.password_hash and check_password_hash(user.password_hash, password):
        log_event(current_app.logger, "user_logged_in", user_id=user.id, email=user.email)
        return jsonify(_user_payload(user))

    if user.password and user.password == password:
        user.password_hash = generate_password_hash(password)
        user.password = None
        db.session.commit()
        log_event(current_app.logger, "legacy_password_upgraded", user_id=user.id, email=user.email)
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
    db.session.commit()
    send_verification_email(user, token)
    log_event(current_app.logger, "verification_email_requested", user_id=user.id, email=user.email)
    return jsonify({"message": "Verification email sent"})


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
    token = clean_string(data.get("token"), "token", required=True, max_length=255)
    new_password = data.get("new_password")

    password_error = _validate_password(new_password)
    if password_error:
        return error_response(password_error, 400, code="invalid_password")

    row = _find_valid_token(PasswordResetToken, token)
    if not row:
        return error_response("Reset token is invalid or expired", 400, code="invalid_reset_token")

    user = User.query.get(row.user_id)
    user.password_hash = generate_password_hash(new_password)
    user.password = None
    row.used_at = datetime.utcnow()
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
