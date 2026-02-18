document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const loginSection = document.getElementById('loginSection');
    const dashboardSection = document.getElementById('dashboardSection');
    const logoutBtn = document.getElementById('logoutBtn');
    const subscribersList = document.getElementById('subscribersList');
    const loading = document.getElementById('loading');
    const table = document.getElementById('subscribersTable');
    const loginError = document.getElementById('loginError');

    // State
    const state = {
        token: localStorage.getItem('adminToken') || null,
        user: JSON.parse(localStorage.getItem('adminUser')) || null
    };

    // Initialize
    if (state.token) {
        initDashboard();
    }

    // Login Handler
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        loginError.style.display = 'none';

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();

            if (res.ok) {
                state.token = data.token;
                state.user = { username: data.username, role: data.role };

                localStorage.setItem('adminToken', state.token);
                localStorage.setItem('adminUser', JSON.stringify(state.user));

                initDashboard();
            } else {
                loginError.textContent = data.message || 'Login failed';
                loginError.style.display = 'block';
            }
        } catch (err) {
            loginError.textContent = 'Network error';
            loginError.style.display = 'block';
        }
    });

    // Logout Handler
    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminUser');
        state.token = null;
        state.user = null;
        window.location.reload();
    });

    // Tab Switching
    document.querySelectorAll('.tabs button').forEach(btn => {
        btn.addEventListener('click', () => {
            // Update buttons
            document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Show content
            document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
            document.getElementById(btn.dataset.tab + 'Tab').style.display = 'block';

            // Load data if needed
            if (btn.dataset.tab === 'admins') loadAdmins();
        });
    });

    // Create Admin Handler
    const createAdminForm = document.getElementById('createAdminForm');
    if (createAdminForm) {
        createAdminForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('newAdminUsername').value;
            const password = document.getElementById('newAdminPassword').value;
            const role = document.getElementById('newAdminRole').value;

            try {
                const res = await fetch('/api/admins', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${state.token}`
                    },
                    body: JSON.stringify({ username, password, role })
                });

                const data = await res.json();
                if (res.ok) {
                    alert('Admin created successfully');
                    createAdminForm.reset();
                    loadAdmins();
                } else {
                    alert(data.message || 'Failed to create admin');
                }
            } catch (err) {
                alert('Network error');
            }
        });
    }

    function initDashboard() {
        loginSection.style.display = 'none';
        dashboardSection.style.display = 'block';

        // Show Admin Tab if Super Admin
        if (state.user && state.user.role === 'super_admin') {
            document.getElementById('adminsTabBtn').style.display = 'block';
        }

        loadSubscribers();
    }

    async function loadSubscribers() {
        const loading = document.getElementById('loadingSubscribers');
        const list = document.getElementById('subscribersList');
        const table = document.getElementById('subscribersTable');

        loading.style.display = 'block';
        table.style.display = 'none';

        try {
            const res = await fetch('/api/subscribers', {
                headers: { 'Authorization': `Bearer ${state.token}` }
            });

            if (res.status === 401) { logoutBtn.click(); return; }

            const data = await res.json();
            if (data.success) {
                list.innerHTML = data.subscribers.map(sub => `
                    <tr>
                        <td>${sub.id}</td>
                        <td>${sub.email}</td>
                        <td>${new Date(sub.subscribed_at).toLocaleString()}</td>
                    </tr>
                `).join('');
                table.style.display = 'table';
            }
        } catch (err) {
            console.error(err);
        } finally {
            loading.style.display = 'none';
        }
    }

    async function loadAdmins() {
        if (state.user.role !== 'super_admin') return;

        const list = document.getElementById('adminsList');

        try {
            const res = await fetch('/api/admins', {
                headers: { 'Authorization': `Bearer ${state.token}` }
            });

            if (res.status === 401) { logoutBtn.click(); return; }

            const data = await res.json();
            if (data.success) {
                list.innerHTML = data.admins.map(admin => `
                    <tr>
                        <td>${admin.id}</td>
                        <td>${admin.username}</td>
                        <td><span class="badge ${admin.role}">${admin.role}</span></td>
                        <td>${new Date(admin.created_at).toLocaleDateString()}</td>
                        <td>
                            ${admin.username !== state.user.username ?
                        `<button onclick="deleteAdmin(${admin.id})" class="btn-sm btn-danger">Delete</button>` :
                        '<span class="text-muted">Current User</span>'}
                        </td>
                    </tr>
                `).join('');
            }
        } catch (err) {
            console.error(err);
        }
    }

    // Expose delete function to window
    window.deleteAdmin = async (id) => {
        if (!confirm('Are you sure you want to delete this admin?')) return;

        try {
            const res = await fetch(`/api/admins/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${state.token}` }
            });

            if (res.ok) {
                loadAdmins();
            } else {
                alert('Failed to delete admin');
            }
        } catch (err) {
            alert('Network error');
        }
    };
});
