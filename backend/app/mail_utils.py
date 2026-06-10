from flask import current_app

from app.logging_utils import log_event

try:
    import resend
except ModuleNotFoundError:  # pragma: no cover - optional dependency in local dev
    resend = None


def _send_mail(to_email, subject, body):
    """Send email through Resend.

    If RESEND_API_KEY is not configured, log the email body for local
    development instead of attempting SMTP.
    """
    api_key = current_app.config.get("RESEND_API_KEY")
    if not api_key:
        log_event(
            current_app.logger,
            "mail_dev_delivery",
            to=to_email,
            subject=subject,
            body=body,
        )
        return False
    if resend is None:
        log_event(
            current_app.logger,
            "mail_provider_unavailable",
            level="warning",
            provider="resend",
            to=to_email,
            subject=subject,
            reason="python_package_not_installed",
        )
        return False

    try:
        resend.api_key = api_key
        resend.Emails.send({
            "from": current_app.config["MAIL_FROM"],
            "to": [to_email],
            "subject": subject,
            "text": body,
        })
    except Exception as exc:
        log_event(
            current_app.logger,
            "resend_delivery_failed",
            level="error",
            to=to_email,
            subject=subject,
            error=str(exc),
        )
        return False

    log_event(
        current_app.logger,
        "resend_delivery_succeeded",
        to=to_email,
        subject=subject,
    )
    return True


def send_verification_email(user, token):
    link = f"{current_app.config['FRONTEND_URL'].rstrip('/')}/verify-email?token={token}"
    body = f"Verify your NjuAtlas email address:\n\n{link}\n\nThis link will expire soon."
    return _send_mail(user.email, "Verify your NjuAtlas email", body)


def send_password_reset_email(user, token):
    link = f"{current_app.config['FRONTEND_URL'].rstrip('/')}/reset-password?token={token}"
    body = f"Reset your NjuAtlas password:\n\n{link}\n\nIgnore this email if you did not request a reset."
    return _send_mail(user.email, "Reset your NjuAtlas password", body)


def send_email_code(to_email, code, purpose):
    if purpose == "register":
        subject = "NjuAtlas 注册验证码"
        action = "完成 NjuAtlas 注册"
    elif purpose == "reset_password":
        subject = "NjuAtlas 重置密码验证码"
        action = "重置 NjuAtlas 密码"
    else:
        subject = "NjuAtlas 验证码"
        action = "继续操作"

    body = (
        f"你的验证码是：{code}\n\n"
        f"请使用该验证码{action}。验证码 10 分钟内有效。\n\n"
        "如果不是你本人操作，请忽略这封邮件。"
    )
    return _send_mail(to_email, subject, body)
