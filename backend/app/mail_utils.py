import smtplib
from email.message import EmailMessage

from flask import current_app

from app.logging_utils import log_event


def _send_mail(to_email, subject, body):
    """Send email through SMTP when configured, otherwise log the message.

    Logging fallback keeps local development and Render previews usable before a
    real mail provider is connected. The token remains stored hashed in the DB;
    only the outbound link contains the raw one-time token.
    """
    smtp_host = current_app.config.get("SMTP_HOST")
    if not smtp_host:
        log_event(
            current_app.logger,
            "mail_dev_delivery",
            to=to_email,
            subject=subject,
            body=body,
        )
        return False

    message = EmailMessage()
    message["From"] = current_app.config["MAIL_FROM"]
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(body)

    try:
        smtp_port = current_app.config["SMTP_PORT"]
        smtp_timeout = current_app.config["SMTP_TIMEOUT_SECONDS"]
        smtp_class = smtplib.SMTP_SSL if current_app.config.get("SMTP_USE_SSL") else smtplib.SMTP

        with smtp_class(smtp_host, smtp_port, timeout=smtp_timeout) as smtp:
            if current_app.config.get("SMTP_USE_TLS") and not current_app.config.get("SMTP_USE_SSL"):
                smtp.starttls()
            username = current_app.config.get("SMTP_USERNAME")
            password = current_app.config.get("SMTP_PASSWORD")
            if username and password:
                smtp.login(username, password)
            smtp.send_message(message)
    except Exception as exc:
        log_event(
            current_app.logger,
            "mail_delivery_failed",
            level="error",
            to=to_email,
            subject=subject,
            error=str(exc),
        )
        return False

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
