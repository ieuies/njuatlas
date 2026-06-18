import { showToast } from '../utils.js';
import { t, getLocale } from '../i18n.js';
import { fetchAuthConfig } from '../api.js';

const DEFAULT_REGISTER_EMAIL_SUFFIXES = ['@smail.nju.edu.cn', '@nju.edu.cn','@163.com'];

let currentModalTab = 'login';
let authConfig = {
    registration_email_restriction_enabled: true,
    registration_email_suffixes: DEFAULT_REGISTER_EMAIL_SUFFIXES,
};

function registrationEmailSuffixes() {
    const suffixes = authConfig.registration_email_suffixes;
    return Array.isArray(suffixes) && suffixes.length ? suffixes : DEFAULT_REGISTER_EMAIL_SUFFIXES;
}

function registrationEmailRestrictionEnabled() {
    return Boolean(authConfig.registration_email_restriction_enabled);
}

function formatRegistrationSuffixes(suffixes = registrationEmailSuffixes()) {
    const joiner = getLocale() === 'en' ? ' or ' : ' 或 ';
    return suffixes.join(joiner);
}

function formatRegistrationEmailExamples(suffixes = registrationEmailSuffixes()) {
    const joiner = getLocale() === 'en' ? ' / ' : ' / ';
    return suffixes.map((suffix) => `name${suffix}`).join(joiner);
}

function registrationEmailI18nParams() {
    const suffixes = registrationEmailSuffixes();
    return {
        suffixes: formatRegistrationSuffixes(suffixes),
        examples: formatRegistrationEmailExamples(suffixes),
    };
}

function isAllowedRegistrationEmail(email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return false;
    if (!registrationEmailRestrictionEnabled()) return true;
    return registrationEmailSuffixes().some((suffix) => normalized.endsWith(suffix));
}

function registrationEmailInvalidMessage() {
    return t('auth.regEmailInvalid', registrationEmailI18nParams());
}

export function applyAuthConfigToRegisterForm(config = authConfig) {
    authConfig = {
        registration_email_restriction_enabled: Boolean(config?.registration_email_restriction_enabled),
        registration_email_suffixes: Array.isArray(config?.registration_email_suffixes) && config.registration_email_suffixes.length
            ? config.registration_email_suffixes
            : DEFAULT_REGISTER_EMAIL_SUFFIXES,
    };

    const hint = document.querySelector('#registerForm .auth-email-hint');
    const regEmailInput = document.getElementById('regEmail');
    const enabled = registrationEmailRestrictionEnabled();
    const i18nParams = registrationEmailI18nParams();

    if (hint) {
        hint.style.display = enabled ? '' : 'none';
        hint.textContent = t('auth.regEmailHint', i18nParams);
    }

    if (regEmailInput) {
        regEmailInput.placeholder = enabled
            ? t('auth.regEmail', i18nParams)
            : t('auth.email');
    }
}

export async function initAuthConfig() {
    try {
        const config = await fetchAuthConfig();
        applyAuthConfigToRegisterForm(config);
    } catch {
        applyAuthConfigToRegisterForm();
    }
}

function startCountdown(button, seconds = 60) {
    let remaining = seconds;
    button.disabled = true;
    const originalText = button.innerText;
    button.innerText = `${remaining}s`;
    const timer = setInterval(() => {
        remaining -= 1;
        button.innerText = `${remaining}s`;
        if (remaining <= 0) {
            clearInterval(timer);
            button.disabled = false;
            button.innerText = originalText;
        }
    }, 1000);
}

function showModal(tab) {
    const modal = document.getElementById('authModal');
    const loginDiv = document.getElementById('loginForm');
    const registerDiv = document.getElementById('registerForm');
    const forgotDiv = document.getElementById('forgotForm');
    loginDiv.style.display = 'none';
    registerDiv.style.display = 'none';
    forgotDiv.style.display = 'none';
    if (tab === 'login') loginDiv.style.display = 'block';
    else if (tab === 'register') registerDiv.style.display = 'block';
    else if (tab === 'forgot') forgotDiv.style.display = 'block';
    modal.style.display = 'flex';
    currentModalTab = tab;
}

function hideModal() {
    document.getElementById('authModal').style.display = 'none';
}

async function handleLogin() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) return showToast('请填写邮箱和密码');
    const loginBtn = document.getElementById('doLoginBtn');
    const originalText = loginBtn.innerText;
    loginBtn.disabled = true;
    loginBtn.innerText = '登录中...';
    const { doLogin, updateUserFromLogin } = await import('../auth.js');
    try {
        const user = await doLogin(email, password);
        updateUserFromLogin(user);
        hideModal();
        // 刷新导航栏
        window.updateNavBar();
        showToast('登录成功');
        const { scheduleMessagesPrefetch } = await import('../messages-prefetch.js');
        scheduleMessagesPrefetch();
    } catch(e) {
        showToast(e.message);
    } finally {
        loginBtn.disabled = false;
        loginBtn.innerText = originalText;
    }
}

async function handleRegister() {
    const username = document.getElementById('regUsername').value;
    const email = document.getElementById('regEmail').value;
    const code = document.getElementById('regCode').value;
    const password = document.getElementById('regPassword').value;
    if (!username || !email || !code || !password) return showToast('请填写完整');
    if (!isAllowedRegistrationEmail(email)) return showToast(registrationEmailInvalidMessage());
    if (password.length < 8) return showToast('密码至少8位');
    const { doRegister } = await import('../auth.js');
    try {
        await doRegister(username, email, password, code);
        hideModal();
        showToast('注册成功，已自动登录');
        window.updateNavBar();
        const { scheduleMessagesPrefetch } = await import('../messages-prefetch.js');
        scheduleMessagesPrefetch();
    } catch(e) {
        showToast(e.message);
    }
}

async function handleForgot() {
    const email = document.getElementById('forgotEmail').value;
    const code = document.getElementById('forgotCode').value;
    const newPassword = document.getElementById('forgotNewPassword').value;
    if (!email || !code || !newPassword) return showToast('请填写邮箱、验证码和新密码');
    if (newPassword.length < 8) return showToast('密码至少8位');
    const { resetPassword } = await import('../api.js');
    await resetPassword(email, code, newPassword);
    showToast('密码已重置，请重新登录');
    showModal('login');
}

async function sendRegisterCode() {
    const email = document.getElementById('regEmail').value;
    if (!email) return showToast('请输入邮箱');
    if (!isAllowedRegistrationEmail(email)) return showToast(registrationEmailInvalidMessage());
    const button = document.getElementById('sendRegCodeBtn');
    const { requestRegisterCode } = await import('../api.js');
    await requestRegisterCode(email);
    showToast('验证码已发送，请查收邮箱');
    startCountdown(button, 60);
}

async function sendForgotCode() {
    const email = document.getElementById('forgotEmail').value;
    if (!email) return showToast('请输入邮箱');
    const button = document.getElementById('sendForgotCodeBtn');
    const { requestPasswordResetCode } = await import('../api.js');
    await requestPasswordResetCode(email);
    showToast('若邮箱存在，验证码已发送');
    startCountdown(button, 60);
}

export function showHomePage() {
    // 绑定主页按钮事件
    document.getElementById('showLoginBtn').onclick = () => showModal('login');
    // 注册按钮在新布局的模态框内，不需要额外绑定
    document.getElementById('switchToRegister').onclick = (e) => { e.preventDefault(); showModal('register'); };
    document.getElementById('switchToLogin').onclick = (e) => { e.preventDefault(); showModal('login'); };
    document.getElementById('forgotPasswordLink').onclick = (e) => { e.preventDefault(); showModal('forgot'); };
    document.getElementById('backToLogin').onclick = (e) => { e.preventDefault(); showModal('login'); };
    document.getElementById('doLoginBtn').onclick = handleLogin;
    document.getElementById('doRegisterBtn').onclick = handleRegister;
    document.getElementById('doForgotBtn').onclick = handleForgot;
    document.getElementById('sendRegCodeBtn').onclick = sendRegisterCode;
    document.getElementById('sendForgotCodeBtn').onclick = sendForgotCode;
}
