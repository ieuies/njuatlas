import { showToast } from '../utils.js';

let currentModalTab = 'login';

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
    const { doLogin, updateUserFromLogin } = await import('../auth.js');
    try {
        const user = await doLogin(email, password);
        updateUserFromLogin(user);
        hideModal();
        // 刷新导航栏
        window.updateNavBar();
        showToast('登录成功');
    } catch(e) {
        showToast(e.message);
    }
}

async function handleRegister() {
    const username = document.getElementById('regUsername').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    if (!username || !email || !password) return showToast('请填写完整');
    if (password.length < 8) return showToast('密码至少8位');
    const { doRegister, updateUserFromLogin } = await import('../auth.js');
    try {
        const user = await doRegister(username, email, password);
        updateUserFromLogin(user);
        hideModal();
        window.updateNavBar();
        showToast('注册成功，已自动登录');
    } catch(e) {
        showToast(e.message);
    }
}

async function handleForgot() {
    const email = document.getElementById('forgotEmail').value;
    if (!email) return showToast('请输入邮箱');
    const { forgotPassword } = await import('../api.js');
    await forgotPassword(email);
    showToast('若邮箱存在，重置链接已发送');
    hideModal();
}

export function showHomePage() {
    // 绑定主页按钮事件
    document.getElementById('getStartedBtn').onclick = () => showModal('login');
    document.getElementById('showLoginBtn').onclick = () => showModal('login');
    // 注册按钮在新布局的模态框内，不需要额外绑定
    document.getElementById('switchToRegister').onclick = (e) => { e.preventDefault(); showModal('register'); };
    document.getElementById('switchToLogin').onclick = (e) => { e.preventDefault(); showModal('login'); };
    document.getElementById('forgotPasswordLink').onclick = (e) => { e.preventDefault(); showModal('forgot'); };
    document.getElementById('backToLogin').onclick = (e) => { e.preventDefault(); showModal('login'); };
    document.getElementById('doLoginBtn').onclick = handleLogin;
    document.getElementById('doRegisterBtn').onclick = handleRegister;
    document.getElementById('doForgotBtn').onclick = handleForgot;
}

export function hideHomePage() {}
