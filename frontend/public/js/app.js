const App = {
  user: null,
  permissions: [],
  currentPage: 'dashboard',

  init() {
    this.checkAuth();
    this.setupEventListeners();
    this.handleRoute();
  },

  checkAuth() {
    const token = localStorage.getItem('agrossam_token');
    const userData = localStorage.getItem('agrossam_user');
    
    if (token && userData) {
      try {
        this.user = JSON.parse(userData);
        this.permissions = JSON.parse(localStorage.getItem('agrossam_permissions') || '[]');
        this.showMainLayout();
      } catch (e) {
        console.error('Error parseando user data:', e);
        this.showLogin();
      }
    } else {
      this.showLogin();
    }
  },

  showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('main-layout').style.display = 'none';
  },

  showMainLayout() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-layout').style.display = 'flex';
    this.updateUserInfo();
  },

  updateUserInfo() {
    if (!this.user) return;
    const initials = Utils.getInitials(this.user.full_name);
    const branchName = (this.user.branch?.name || 'Sin sucursal')
      .replace(/\bSucursal Principal\b/gi, 'Sede Principal')
      .replace(/\s*-\s*Lima\b/gi, '')
      .replace(/\bLima\b\s*-\s*/gi, '')
      .replace(/\bLima\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim() || 'Sin sucursal';

    document.getElementById('sidebar-avatar').textContent = initials;
    document.getElementById('sidebar-username').textContent = this.user.full_name;
    document.getElementById('sidebar-branch').textContent = branchName;
    document.getElementById('topbar-avatar').textContent = initials;
    document.getElementById('topbar-username').textContent = this.user.full_name;
    document.getElementById('topbar-role').textContent = Utils.getRoleLabel(this.user.role);
    document.getElementById('topbar-branch').textContent = branchName;
    document.getElementById('topbar-date').textContent = Utils.getCurrentDateFormatted();

    const adminSection = document.getElementById('admin-section');
    if (adminSection) {
      adminSection.style.display =
        (this.user.role === 'administrador' || this.user.role === 'admin_sucursal') ? 'block' : 'none';
    }
  },

  setupEventListeners() {
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => this.handleLogin(e));
    }

    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => this.handleLogout());
    }

    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.hash = `#/${item.dataset.page}`;
      });
    });

    window.addEventListener('hashchange', () => this.handleRoute());

    document.getElementById('btn-toggle-sidebar')?.addEventListener('click', () => {
      document.querySelector('.sidebar').classList.toggle('open');
    });

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'i') {
        e.preventDefault();
        document.getElementById('global-search')?.focus();
      }
    });
  },

  async handleLogin(e) {
    e.preventDefault();
    
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const errorDiv = document.getElementById('login-error');
    const submitBtn = e.target.querySelector('button[type="submit"]');
    
    errorDiv.textContent = '';
    errorDiv.style.display = 'none';
    
    console.log(' Intentando login con:', email);

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Iniciando sesión...';

      const result = await api.login(email, password);
      
      console.log('✅ Login exitoso:', result);
      
      api.setToken(result.token);
      localStorage.setItem('agrossam_user', JSON.stringify(result.user));
      localStorage.setItem('agrossam_permissions', JSON.stringify(result.permissions));
      
      this.user = result.user;
      this.permissions = result.permissions;
      
      this.showMainLayout();
      window.location.hash = '#/dashboard';
      
      Utils.showToast(`Bienvenido, ${result.user.full_name}`);
    } catch (err) {
      console.error('❌ Error en login:', err);
      errorDiv.textContent = err.message || 'Error al iniciar sesión';
      errorDiv.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Iniciar Sesión';
    }
  },

  async handleLogout() {
    if (!window.confirm('¿Está seguro que desea cerrar sesión?')) return;
    
    try {
      await api.logout();
    } catch (err) {
      console.error('Error en logout:', err);
    }
    
    api.clearToken();
    this.user = null;
    this.permissions = [];
    this.showLogin();
    window.location.hash = '';
    
    document.getElementById('email').value = '';
    document.getElementById('password').value = '';
  },

  handleRoute() {
    const hash = window.location.hash || '#/dashboard';
    const page = hash.replace('#/', '') || 'dashboard';

    if (!this.user && page !== 'login') {
      window.location.hash = '#/login';
      return;
    }

    this.currentPage = page;
    this.updateActiveNav(page);
    this.loadPage(page);
  },

  updateActiveNav(page) {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });
    
    const pageNames = {
      dashboard: 'Dashboard',
      users: 'Usuarios y Permisos',
      branches: 'Sucursales',
      inventory: 'Inventario',
      contacts: 'Contactos',
      sales: 'Facturación y Notas',
      purchases: 'Compras a Proveedores',
      payments: 'Pagos y Cobros',
      reports: 'Reportes'
    };
    
    document.getElementById('topbar-page').textContent = pageNames[page] || page;
  },

  async loadPage(page) {
    const content = document.getElementById('page-content');
    content.innerHTML = '<div class="spinner"></div>';

    try {
      switch (page) {
        case 'dashboard': await this.loadDashboard(content); break;
        case 'users': await this.loadUsers(content); break;
        case 'branches': await this.loadBranches(content); break;
        case 'inventory': await this.loadInventory(content); break;
        case 'products': await this.loadProducts(content); break;
        case 'contacts': await this.loadContacts(content); break;
        case 'pos': await this.loadPOS(content); break;
        case 'sales': await this.loadSales(content); break;
        case 'payments': await this.loadPayments(content); break;
        case 'purchases': await this.loadPurchases(content); break;
        case 'reports': await this.loadReports(content); break;
        default:
          content.innerHTML = `
            <div class="empty-state">
              <div class="icon">${Utils.icon('report')}</div>
              <h3>Página en construcción</h3>
              <p>El módulo "${page}" estará disponible próximamente.</p>
            </div>`;
      }
    } catch (err) {
      console.error('Error cargando página:', err);
      content.innerHTML = `
        <div class="empty-state">
          <div class="icon">${Utils.icon('alert')}</div>
          <h3>Error al cargar</h3>
          <p>${err.message}</p>
        </div>`;
    }
  },

  async loadDashboard(container) {
    container.innerHTML = `
      <div class="dashboard-welcome">
        <div>
          <div class="dashboard-eyebrow">PANEL DE CONTROL</div>
          <h1 id="dashboard-greeting">Resumen de operaciones</h1>
          <p id="dashboard-branch" class="text-muted"></p>
        </div>
        <a href="#/pos" class="btn btn-primary">${Utils.icon('cart')} Nueva venta</a>
      </div>

      <div class="dashboard-kpis">
        <article class="dashboard-kpi">
          <span class="dashboard-kpi-icon">${Utils.icon('wallet')}</span>
          <div><div class="kpi-label">Ventas de este mes</div><div class="dashboard-kpi-value" id="dashboard-sales">—</div></div>
        </article>
        <article class="dashboard-kpi">
          <span class="dashboard-kpi-icon">${Utils.icon('receipt')}</span>
          <div><div class="kpi-label">Facturas emitidas</div><div class="dashboard-kpi-value" id="dashboard-invoices">—</div></div>
        </article>
        <article class="dashboard-kpi">
          <span class="dashboard-kpi-icon">${Utils.icon('chart')}</span>
          <div><div class="kpi-label">Promedio por venta</div><div class="dashboard-kpi-value" id="dashboard-average">—</div></div>
        </article>
        <article class="dashboard-kpi">
          <span class="dashboard-kpi-icon">${Utils.icon('package')}</span>
          <div><div class="kpi-label">Unidades vendidas</div><div class="dashboard-kpi-value" id="dashboard-units">—</div></div>
        </article>
      </div>

      <div class="dashboard-main-grid">
        <section class="card dashboard-panel">
          <div class="card-header">
            <div>
              <h3>Productos más vendidos</h3>
              <p class="text-muted">Este mes, por cantidad de unidades</p>
            </div>
            <span class="dashboard-period">${Utils.icon('chart')} Este mes</span>
          </div>
          <div class="dashboard-top-products" id="dashboard-top-products">
            <div class="dashboard-loading">Cargando resumen de ventas...</div>
          </div>
          <a class="dashboard-panel-link" href="#/sales">Ver facturas de venta ${Utils.icon('arrow-right')}</a>
        </section>

        <section class="dashboard-shortcuts">
          <h2>Accesos rápidos</h2>
          <a href="#/pos" class="dashboard-shortcut">
            <span class="dashboard-shortcut-icon">${Utils.icon('cart')}</span>
            <span><strong>Registrar una venta</strong><small>Abrir el punto de venta</small></span>
            ${Utils.icon('arrow-right', 'dashboard-arrow')}
          </a>
          <a href="#/inventory" class="dashboard-shortcut">
            <span class="dashboard-shortcut-icon">${Utils.icon('warehouse')}</span>
            <span><strong>Revisar inventario</strong><small>Consultar productos y existencias</small></span>
            ${Utils.icon('arrow-right', 'dashboard-arrow')}
          </a>
          <a href="#/purchases" class="dashboard-shortcut">
            <span class="dashboard-shortcut-icon">${Utils.icon('package')}</span>
            <span><strong>Registrar una compra</strong><small>Ingresar productos de proveedor</small></span>
            ${Utils.icon('arrow-right', 'dashboard-arrow')}
          </a>
        </section>
      </div>
    `;

    const userName = this.user?.full_name?.trim().split(/\s+/)[0] || 'bienvenido';
    document.getElementById('dashboard-greeting').textContent = `Hola, ${userName}`;
    document.getElementById('dashboard-branch').textContent =
      `${this.user?.company?.name || 'AGROSSAM'} · ${this.user?.branch?.name || 'Todas las sucursales'}`;

    try {
      const { summary, top_products: topProducts } = await api.getSalesDashboard();
      const quantityFormat = new Intl.NumberFormat('es-NI', { maximumFractionDigits: 2 });
      document.getElementById('dashboard-sales').textContent = Utils.formatCurrency(summary.sales_total);
      document.getElementById('dashboard-invoices').textContent = Utils.formatNumber(summary.invoice_count);
      document.getElementById('dashboard-average').textContent = Utils.formatCurrency(summary.average_sale);
      document.getElementById('dashboard-units').textContent = quantityFormat.format(summary.units_sold || 0);

      const topProductsContainer = document.getElementById('dashboard-top-products');
      if (!topProducts?.length) {
        topProductsContainer.innerHTML = `
          <div class="dashboard-empty">
            <span class="dashboard-empty-icon">${Utils.icon('chart')}</span>
            <strong>Aún no hay ventas este mes</strong>
            <span>Cuando registres ventas, aquí verás tus productos más vendidos.</span>
          </div>
        `;
        return;
      }

      const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[char]);
      topProductsContainer.innerHTML = topProducts.map((product, index) => `
        <div class="dashboard-product-row">
          <span class="dashboard-rank">${String(index + 1).padStart(2, '0')}</span>
          <span class="dashboard-product-name">${escapeHTML(product.name)}</span>
          <span class="dashboard-product-quantity">${quantityFormat.format(product.quantity_sold)} <small>unid.</small></span>
        </div>
      `).join('');
    } catch (err) {
      console.error('Error cargando resumen del dashboard:', err);
      document.getElementById('dashboard-top-products').innerHTML = `
        <div class="dashboard-load-error">No se pudo cargar el resumen de ventas. Verifica los permisos de facturas e inténtalo nuevamente.</div>
      `;
      ['dashboard-sales', 'dashboard-invoices', 'dashboard-average', 'dashboard-units']
        .forEach(id => { document.getElementById(id).textContent = '—'; });
    }
  },

  async loadReports(container) {
    const now = new Date();
    const toDate = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('-');
    const fromDate = `${toDate.slice(0, 7)}-01`;

    container.innerHTML = `
      <div class="reports-header">
        <div>
          <span class="reports-eyebrow">${Utils.icon('chart')} CENTRO DE ANÁLISIS</span>
          <h1>Reportes de ventas</h1>
          <p>Consulta el rendimiento de tu sucursal y analiza las ventas por período.</p>
        </div>
        <div class="reports-header-icon">${Utils.icon('report')}</div>
      </div>

      <div class="reports-filter card mb-3">
        <div class="reports-filter-copy">
          <span class="reports-filter-icon">${Utils.icon('calendar')}</span>
          <div><strong>Período del reporte</strong><small>Selecciona las fechas que quieres analizar</small></div>
        </div>
        <div class="reports-filter-controls">
          <label>Desde<input type="date" id="report-from-date" value="${fromDate}"></label>
          <span class="reports-date-separator">hasta</span>
          <label>Hasta<input type="date" id="report-to-date" value="${toDate}"></label>
          <button class="btn btn-primary" id="btn-load-report">${Utils.icon('chart')} Generar reporte</button>
        </div>
      </div>

      <div id="report-results">
        <div class="spinner"></div>
      </div>
    `;

    const loadReport = async () => {
      const from = document.getElementById('report-from-date').value;
      const to = document.getElementById('report-to-date').value;
      if (!from || !to || from > to) {
        Utils.showToast('Selecciona un rango de fechas válido', 'error');
        return;
      }

      const results = document.getElementById('report-results');
      results.innerHTML = '<div class="spinner"></div>';
      try {
        const report = await api.getSalesReport({ from_date: from, to_date: to });
        const summary = report.summary || {};
        const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        })[char]);
        const dailySales = report.daily_sales || [];
        const maxDailyTotal = Math.max(...dailySales.map(day => Number(day.total) || 0), 0);

        results.innerHTML = `
          <div class="reports-kpis mb-3">
            <div class="report-stat-card report-stat-primary">
              <span class="report-stat-icon">${Utils.icon('wallet')}</span>
              <div><div class="kpi-label">Ventas del período</div><div class="report-stat-value">${Utils.formatCurrency(summary.sales_total)}</div></div>
            </div>
            <div class="report-stat-card">
              <span class="report-stat-icon">${Utils.icon('receipt')}</span>
              <div><div class="kpi-label">Facturas emitidas</div><div class="report-stat-value">${Utils.formatNumber(summary.invoice_count)}</div></div>
            </div>
            <div class="report-stat-card">
              <span class="report-stat-icon">${Utils.icon('chart')}</span>
              <div><div class="kpi-label">Promedio por factura</div><div class="report-stat-value">${Utils.formatCurrency(summary.average_sale)}</div></div>
            </div>
            <div class="report-stat-card report-stat-warning">
              <span class="report-stat-icon">${Utils.icon('clock')}</span>
              <div><div class="kpi-label">Pendiente de cobro</div><div class="report-stat-value">${Utils.formatCurrency(summary.receivable_total)}</div></div>
            </div>
          </div>

          <div class="reports-panels">
            <section class="card report-panel">
              <div class="card-header">
                <div class="report-panel-title"><span class="report-panel-icon">${Utils.icon('chart')}</span><div><h3>Ventas por día</h3><p class="text-muted">Total facturado por fecha</p></div></div>
                <span class="report-panel-count">${dailySales.length} días</span>
              </div>
              ${dailySales.length ? `
                <div class="table-container">
                  <table class="report-table">
                    <thead><tr><th>Fecha</th><th>Ventas</th><th>Total</th></tr></thead>
                    <tbody>${dailySales.map(day => {
                      const percentage = maxDailyTotal
                        ? Math.max(4, (Number(day.total) / maxDailyTotal) * 100)
                        : 0;
                      return `
                        <tr>
                          <td>${Utils.formatDate(day.date)}</td>
                          <td><div class="report-bar-track"><div class="report-bar-fill" style="width:${percentage}%;"></div></div></td>
                          <td class="report-amount">${Utils.formatCurrency(day.total)}</td>
                        </tr>
                      `;
                    }).join('')}</tbody>
                  </table>
                </div>
              ` : '<div class="dashboard-empty">No hay ventas en el período seleccionado.</div>'}
            </section>

            <section class="card report-panel">
              <div class="card-header">
                <div class="report-panel-title"><span class="report-panel-icon">${Utils.icon('package')}</span><div><h3>Productos más vendidos</h3><p class="text-muted">Por cantidad de unidades</p></div></div>
                <span class="report-panel-count">Top 10</span>
              </div>
              ${(report.top_products || []).length ? `
                <div class="table-container">
                  <table class="report-table">
                    <thead><tr><th>Producto</th><th>Unidades</th><th>Ventas</th></tr></thead>
                    <tbody>${report.top_products.map(product => `
                      <tr>
                        <td><span class="report-product-name">${escapeHTML(product.name)}</span></td>
                        <td><span class="report-units">${Utils.formatNumber(product.quantity_sold)} unid.</span></td>
                        <td class="report-amount">${Utils.formatCurrency(product.sales_amount)}</td>
                      </tr>
                    `).join('')}</tbody>
                  </table>
                </div>
              ` : '<div class="dashboard-empty">No hay productos vendidos en este período.</div>'}
            </section>
          </div>
        `;
      } catch (err) {
        console.error('Error generando reporte:', err);
        results.innerHTML = `<div class="empty-state"><p>No se pudo generar el reporte. Inténtalo nuevamente.</p></div>`;
        Utils.showToast('Error generando reporte', 'error');
      }
    };

    document.getElementById('btn-load-report').addEventListener('click', loadReport);
    await loadReport();
  },

  async loadUsers(container) {
    container.innerHTML = `
      <div class="page-header d-flex justify-between align-center">
        <div>
          <h1>Usuarios y Permisos</h1>
          <p class="text-muted">Gestión de usuarios del sistema</p>
        </div>
        <button class="btn btn-primary" id="btn-new-user"> Nuevo Usuario</button>
      </div>

      <div class="card mb-3">
        <div class="card-body">
          <div class="d-flex gap-2">
            <input type="text" id="search-users" placeholder="Buscar por nombre o email..."
              style="flex:1; padding:10px 16px; border:2px solid var(--border-color); border-radius:var(--radius-sm); font-size:14px;">
            <select id="filter-role" style="padding:10px 16px; border:2px solid var(--border-color); border-radius:var(--radius-sm);">
              <option value="">Todos los roles</option>
              <option value="administrador">Administrador</option>
              <option value="admin_sucursal">Admin. Sucursal</option>
              <option value="ventas">Ventas</option>
              <option value="inventario">Inventario</option>
              <option value="contabilidad">Contabilidad</option>
            </select>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Sucursal</th>
                <th>Estado</th>
                <th>Último Login</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody id="users-table-body">
              <tr><td colspan="7" style="text-align:center; padding:40px;">Cargando...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('btn-new-user').addEventListener('click', () => this.showUserModal());

    const searchInput = document.getElementById('search-users');
    const roleFilter = document.getElementById('filter-role');

    const loadUsers = async () => {
      const params = {};
      if (searchInput.value) params.search = searchInput.value;
      if (roleFilter.value) params.role = roleFilter.value;

      try {
        const data = await api.getUsers(params);
        this.renderUsersTable(data.users || []);
      } catch (err) {
        Utils.showToast('Error cargando usuarios', 'error');
      }
    };

    searchInput.addEventListener('input', Utils.debounce(loadUsers, 300));
    roleFilter.addEventListener('change', loadUsers);

    await loadUsers();
  },

  renderUsersTable(users) {
    const tbody = document.getElementById('users-table-body');

    if (users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:40px; color:var(--text-muted);">No se encontraron usuarios</td></tr>';
      return;
    }

    tbody.innerHTML = users.map(u => `
      <tr>
        <td>
          <div class="d-flex align-center gap-1">
            <div class="user-avatar" style="width:32px;height:32px;background:var(--primary);color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">${Utils.getInitials(u.full_name)}</div>
            <strong>${u.full_name}</strong>
          </div>
        </td>
        <td>${u.email}</td>
        <td><span class="badge-status info">${Utils.getRoleLabel(u.role)}</span></td>
        <td>${u.branches?.branch_name || '-'}</td>
        <td>
          <span class="badge-status ${u.is_active ? 'success' : 'danger'}">
            ${u.is_active ? 'Activo' : 'Inactivo'}
          </span>
        </td>
        <td>${u.last_login ? Utils.formatDate(u.last_login) : 'Nunca'}</td>
        <td>
          <div class="d-flex gap-1">
            <button class="btn btn-sm btn-secondary" aria-label="Editar usuario" title="Editar usuario" onclick="App.editUser('${u.id}')">${Utils.icon('edit')}</button>
            <button class="btn btn-sm btn-danger" aria-label="Desactivar usuario" title="Desactivar usuario" onclick="App.deleteUser('${u.id}', '${u.full_name}')">${Utils.icon('trash')}</button>
          </div>
        </td>
      </tr>
    `).join('');
  },

  showUserModal(user = null) {
    const isEdit = !!user;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'user-modal';

    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>${isEdit ? 'Editar Usuario' : 'Nuevo Usuario'}</h3>
          <button class="btn-icon" onclick="document.getElementById('user-modal').remove()">✕</button>
        </div>
        <div class="modal-body">
          <form id="user-form">
            <div class="form-grid">
              <div class="form-group full-width">
                <label>Nombre Completo *</label>
                <input type="text" id="user-fullname" required value="${user?.full_name || ''}">
              </div>
              <div class="form-group">
                <label>Email *</label>
                <input type="email" id="user-email" required value="${user?.email || ''}" ${isEdit ? 'readonly' : ''}>
              </div>
              ${!isEdit ? `
              <div class="form-group">
                <label>Contraseña *</label>
                <input type="password" id="user-password" required minlength="6" placeholder="Mínimo 6 caracteres">
              </div>` : ''}
              <div class="form-group">
                <label>Rol *</label>
                <select id="user-role" required>
                  <option value="administrador" ${user?.role === 'administrador' ? 'selected' : ''}>Administrador</option>
                  <option value="admin_sucursal" ${user?.role === 'admin_sucursal' ? 'selected' : ''}>Admin. Sucursal</option>
                  <option value="ventas" ${user?.role === 'ventas' ? 'selected' : ''}>Ventas</option>
                  <option value="inventario" ${user?.role === 'inventario' ? 'selected' : ''}>Inventario</option>
                  <option value="contabilidad" ${user?.role === 'contabilidad' ? 'selected' : ''}>Contabilidad</option>
                </select>
              </div>
              <div class="form-group full-width">
                <label>Sucursal</label>
                <select id="user-branch">
                  <option value="">Sin sucursal asignada</option>
                </select>
              </div>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('user-modal').remove()">Cancelar</button>
          <button class="btn btn-primary" id="btn-save-user">${isEdit ? 'Guardar Cambios' : 'Crear Usuario'}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    this.loadBranchesForSelect(document.getElementById('user-branch'), user?.branch_id);

    document.getElementById('btn-save-user').addEventListener('click', async () => {
      const fullName = document.getElementById('user-fullname').value.trim();
      const email = document.getElementById('user-email').value.trim();
      const password = document.getElementById('user-password')?.value;
      const role = document.getElementById('user-role').value;
      const branchId = document.getElementById('user-branch').value || null;

      if (!fullName || !email || !role) {
        Utils.showToast('Complete los campos requeridos', 'error');
        return;
      }

      if (!isEdit && (!password || password.length < 6)) {
        Utils.showToast('La contraseña debe tener al menos 6 caracteres', 'error');
        return;
      }

      try {
        const btn = document.getElementById('btn-save-user');
        btn.disabled = true;
        btn.textContent = 'Guardando...';

        if (isEdit) {
          await api.updateUser(user.id, { full_name: fullName, role, branch_id: branchId });
          Utils.showToast('Usuario actualizado exitosamente');
        } else {
          await api.createUser({ full_name: fullName, email, password, role, branch_id: branchId });
          Utils.showToast('Usuario creado exitosamente');
        }

        document.getElementById('user-modal').remove();
        this.loadUsers(document.getElementById('page-content'));
      } catch (err) {
        Utils.showToast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = isEdit ? 'Guardar Cambios' : 'Crear Usuario';
      }
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  },

  async loadBranchesForSelect(selectEl, selectedId = null) {
    try {
      const data = await api.getBranches({ is_active: 'true' });
      selectEl.innerHTML = '<option value="">Sin sucursal asignada</option>' +
        (data.branches || []).map(b =>
          `<option value="${b.id}" ${b.id === selectedId ? 'selected' : ''}>${b.name} (${b.code})</option>`
        ).join('');
    } catch (err) {
      console.error('Error cargando sucursales:', err);
    }
  },

  async editUser(id) {
    try {
      const data = await api.getUser(id);
      this.showUserModal(data.user);
    } catch (err) {
      Utils.showToast('Error al cargar usuario', 'error');
    }
  },

  async deleteUser(id, name) {
    if (!window.confirm(`¿Está seguro que desea desactivar al usuario "${name}"?`)) return;
    try {
      await api.deleteUser(id);
      Utils.showToast('Usuario desactivado exitosamente');
      this.loadUsers(document.getElementById('page-content'));
    } catch (err) {
      Utils.showToast(err.message, 'error');
    }
  },

  async loadBranches(container) {
    container.innerHTML = `
      <div class="page-header d-flex justify-between align-center">
        <div>
          <h1>Sucursales</h1>
          <p class="text-muted">Gestión de sucursales de la empresa</p>
        </div>
        <button class="btn btn-primary" id="btn-new-branch">${Utils.icon('plus')} Nueva Sucursal</button>
      </div>

      <div class="card mb-3">
        <div class="card-body">
          <input type="text" id="search-branches" placeholder="Buscar por nombre o código..."
            style="width:100%; padding:10px 16px; border:2px solid var(--border-color); border-radius:var(--radius-sm); font-size:14px;">
        </div>
      </div>

      <div id="branches-grid" class="kpi-grid">
        <div style="text-align:center; padding:40px; grid-column:1/-1;">Cargando...</div>
      </div>
    `;

    document.getElementById('btn-new-branch').addEventListener('click', () => this.showBranchModal());

    const searchInput = document.getElementById('search-branches');
    const loadBranches = async () => {
      try {
        const params = {};
        if (searchInput.value) params.search = searchInput.value;
        const data = await api.getBranches(params);
        this.renderBranchesGrid(data.branches || []);
      } catch (err) {
        Utils.showToast('Error cargando sucursales', 'error');
      }
    };

    searchInput.addEventListener('input', Utils.debounce(loadBranches, 300));
    await loadBranches();
  },

  renderBranchesGrid(branches) {
    const grid = document.getElementById('branches-grid');

    if (branches.length === 0) {
      grid.innerHTML = '<div style="text-align:center; padding:40px; grid-column:1/-1; color:var(--text-muted);">No se encontraron sucursales</div>';
      return;
    }

    grid.innerHTML = branches.map(b => `
      <div class="kpi-card" style="cursor:pointer;" onclick="App.editBranch('${b.id}')">
        <div class="d-flex justify-between align-center mb-2">
          <span class="badge-status ${b.is_active ? 'success' : 'danger'}">
            ${b.is_active ? 'Activa' : 'Inactiva'}
          </span>
          <span style="font-size:12px; color:var(--text-muted); font-weight:600;">${b.code}</span>
        </div>
        <div style="font-size:20px; font-weight:700; margin-bottom:8px;">${b.name}</div>
        <div style="font-size:13px; color:var(--text-muted); margin-bottom:4px;"> ${b.address || 'Sin dirección'}</div>
        <div style="font-size:13px; color:var(--text-muted); margin-bottom:4px;">${Utils.icon('phone')} ${b.phone || 'Sin teléfono'}</div>
        <div style="font-size:13px; color:var(--text-muted);">${Utils.icon('mail')} ${b.email || 'Sin email'}</div>
        <div class="d-flex gap-1 mt-2">
          <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); App.editBranch('${b.id}')">${Utils.icon('edit')} Editar</button>
          <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); App.deleteBranch('${b.id}', '${b.name}')">️</button>
        </div>
      </div>
    `).join('');
  },

  showBranchModal(branch = null) {
    const isEdit = !!branch;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'branch-modal';

    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>${isEdit ? 'Editar Sucursal' : 'Nueva Sucursal'}</h3>
          <button class="btn-icon" onclick="document.getElementById('branch-modal').remove()">✕</button>
        </div>
        <div class="modal-body">
          <form id="branch-form">
            <div class="form-grid">
              <div class="form-group">
                <label>Nombre *</label>
                <input type="text" id="branch-name" required value="${branch?.name || ''}">
              </div>
              <div class="form-group">
                <label>Código *</label>
                <input type="text" id="branch-code" required value="${branch?.code || ''}" placeholder="Ej: LIM-01">
              </div>
              <div class="form-group full-width">
                <label>Dirección</label>
                <input type="text" id="branch-address" value="${branch?.address || ''}">
              </div>
              <div class="form-group">
                <label>Teléfono</label>
                <input type="text" id="branch-phone" value="${branch?.phone || ''}">
              </div>
              <div class="form-group">
                <label>Email</label>
                <input type="email" id="branch-email" value="${branch?.email || ''}">
              </div>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('branch-modal').remove()">Cancelar</button>
          <button class="btn btn-primary" id="btn-save-branch">${isEdit ? 'Guardar Cambios' : 'Crear Sucursal'}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('btn-save-branch').addEventListener('click', async () => {
      const name = document.getElementById('branch-name').value.trim();
      const code = document.getElementById('branch-code').value.trim();
      const address = document.getElementById('branch-address').value.trim();
      const phone = document.getElementById('branch-phone').value.trim();
      const email = document.getElementById('branch-email').value.trim();

      if (!name || !code) {
        Utils.showToast('Nombre y código son requeridos', 'error');
        return;
      }

      try {
        const btn = document.getElementById('btn-save-branch');
        btn.disabled = true;
        btn.textContent = 'Guardando...';

        if (isEdit) {
          await api.updateBranch(branch.id, { name, code, address, phone, email });
          Utils.showToast('Sucursal actualizada exitosamente');
        } else {
          await api.createBranch({ name, code, address, phone, email });
          Utils.showToast('Sucursal creada exitosamente');
        }

        document.getElementById('branch-modal').remove();
        this.loadBranches(document.getElementById('page-content'));
      } catch (err) {
        Utils.showToast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = isEdit ? 'Guardar Cambios' : 'Crear Sucursal';
      }
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  },

  async editBranch(id) {
    try {
      const data = await api.getBranch(id);
      this.showBranchModal(data.branch);
    } catch (err) {
      Utils.showToast('Error al cargar sucursal', 'error');
    }
  },

  async deleteBranch(id, name) {
    if (!window.confirm(`¿Está seguro que desea desactivar la sucursal "${name}"?`)) return;
    try {
      await api.deleteBranch(id);
      Utils.showToast('Sucursal desactivada exitosamente');
      this.loadBranches(document.getElementById('page-content'));
    } catch (err) {
      Utils.showToast(err.message, 'error');
    }
    
  },
  // ==========================================
// INVENTARIO - Vista principal con tabs
// ==========================================
async loadInventory(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Inventario</h1>
      <p class="text-muted">Gestión de productos, stock y movimientos</p>
    </div>

    <div class="card mb-3">
      <div class="card-body" style="padding:12px 24px;">
        <div class="d-flex gap-1" style="flex-wrap:wrap;">
          <button class="btn btn-primary inv-tab" data-tab="products">${Utils.icon('package')} Productos</button>
          <button class="btn btn-secondary inv-tab" data-tab="stock">${Utils.icon('chart')} Stock</button>
          <button class="btn btn-secondary inv-tab" data-tab="movements">${Utils.icon('refresh')} Movimientos</button>
          <button class="btn btn-secondary inv-tab" data-tab="batches">${Utils.icon('tag')} Lotes</button>
          <button class="btn btn-secondary inv-tab" data-tab="warehouses">${Utils.icon('warehouse')} Bodegas</button>
        </div>
      </div>
    </div>

    <div id="inventory-content"></div>
  `;

  // Manejar tabs
  container.querySelectorAll('.inv-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.inv-tab').forEach(b => {
        b.className = 'btn btn-secondary inv-tab';
      });
      btn.className = 'btn btn-primary inv-tab';
      this.loadInventoryTab(btn.dataset.tab);
    });
  });

  // Cargar primera tab
  this.loadInventoryTab('products');
},

async loadInventoryTab(tab) {
  const content = document.getElementById('inventory-content');
  content.innerHTML = '<div class="spinner"></div>';

  try {
    switch (tab) {
      case 'products': await this.loadProductsView(content); break;
      case 'stock': await this.loadStockView(content); break;
      case 'movements': await this.loadMovementsView(content); break;
      case 'batches': await this.loadBatchesView(content); break;
      case 'warehouses': await this.loadWarehousesView(content); break;
    }
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
  }
},

// ==========================================
// PRODUCTOS
// ==========================================
async loadProductsView(container) {
  container.innerHTML = `
    <div class="d-flex justify-between align-center mb-3">
      <h2>Productos</h2>
      <div class="d-flex gap-1">
        <button class="btn btn-primary" id="btn-new-product"> Nuevo Producto</button>
        <button class="btn btn-secondary" id="btn-new-category"> Nueva Categoría</button>
      </div>
    </div>

    <div class="card mb-3">
      <div class="card-body">
        <div class="d-flex gap-2">
          <input type="text" id="search-products" placeholder="Buscar por nombre, SKU o código de barras..."
            style="flex:1; padding:10px 16px; border:2px solid var(--border-color); border-radius:var(--radius-sm);">
          <select id="filter-category" style="padding:10px 16px; border:2px solid var(--border-color); border-radius:var(--radius-sm);">
            <option value="">Todas las categorías</option>
          </select>
          <select id="filter-stock" style="padding:10px 16px; border:2px solid var(--border-color); border-radius:var(--radius-sm);">
            <option value="">Todo el stock</option>
            <option value="low">Stock bajo</option>
          </select>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Producto</th>
              <th>Categoría</th>
              <th>P. Costo</th>
              <th>P. Venta</th>
              <th>Stock Total</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody id="products-table-body">
            <tr><td colspan="8" style="text-align:center; padding:40px;">Cargando...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('btn-new-product').addEventListener('click', () => this.showProductModal());
  document.getElementById('btn-new-category').addEventListener('click', () => this.showCategoryModal());

  const searchInput = document.getElementById('search-products');
  const categoryFilter = document.getElementById('filter-category');
  const stockFilter = document.getElementById('filter-stock');

  // Cargar categorías
  try {
    const catData = await api.getCategories();
    categoryFilter.innerHTML = '<option value="">Todas las categorías</option>' +
      (catData.categories || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  } catch (err) { console.error(err); }

  const loadProducts = async () => {
    const params = {};
    if (searchInput.value) params.search = searchInput.value;
    if (categoryFilter.value) params.category_id = categoryFilter.value;
    if (stockFilter.value) params.min_stock = stockFilter.value;

    try {
      const data = await api.getProducts(params);
      this.renderProductsTable(data.products || []);
    } catch (err) {
      Utils.showToast('Error cargando productos', 'error');
    }
  };

  searchInput.addEventListener('input', Utils.debounce(loadProducts, 300));
  categoryFilter.addEventListener('change', loadProducts);
  stockFilter.addEventListener('change', loadProducts);

  await loadProducts();
},

renderProductsTable(products) {
  const tbody = document.getElementById('products-table-body');

  if (products.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:40px; color:var(--text-muted);">No se encontraron productos</td></tr>';
    return;
  }

  tbody.innerHTML = products.map(p => {
    const isLow = p.total_stock <= p.min_stock;
    return `
      <tr>
        <td><strong>${p.sku}</strong></td>
        <td>
          <div style="font-weight:600;">${p.name}</div>
          ${p.description ? `<div class="text-muted" style="font-size:12px;">${p.description}</div>` : ''}
        </td>
        <td>${p.categories?.name || '-'}</td>
        <td>${Utils.formatCurrency(p.cost_price)}</td>
        <td><strong>${Utils.formatCurrency(p.sale_price)}</strong></td>
        <td>
          <span class="${isLow ? 'text-danger fw-bold' : ''}">
            ${Utils.formatNumber(p.total_stock)} ${p.unit}
          </span>
          ${isLow ? `<div style="font-size:11px; color:var(--danger);">${Utils.icon('alert')} Stock bajo</div>` : ''}
        </td>
        <td>
          <span class="badge-status ${p.is_active ? 'success' : 'danger'}">
            ${p.is_active ? 'Activo' : 'Inactivo'}
          </span>
        </td>
        <td>
          <div class="d-flex gap-1">
            <button class="btn btn-sm btn-secondary" aria-label="Editar producto" title="Editar producto" onclick="App.editProduct('${p.id}')">${Utils.icon('edit')}</button>
            <button class="btn btn-sm btn-danger" aria-label="Desactivar producto" title="Desactivar producto" onclick="App.deleteProduct('${p.id}', '${p.name.replace(/'/g, "\\'")}')">${Utils.icon('trash')}</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
},

showProductModal(product = null) {
  const isEdit = !!product;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'product-modal';

  overlay.innerHTML = `
    <div class="modal" style="max-width:700px;">
      <div class="modal-header">
        <h3>${isEdit ? 'Editar Producto' : 'Nuevo Producto'}</h3>
        <button class="btn-icon" onclick="document.getElementById('product-modal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group">
            <label>SKU *</label>
            <input type="text" id="prod-sku" required value="${product?.sku || ''}" ${isEdit ? 'readonly' : ''}>
          </div>
          <div class="form-group">
            <label>Código de Barras</label>
            <input type="text" id="prod-barcode" value="${product?.barcode || ''}">
          </div>
          <div class="form-group full-width">
            <label>Nombre *</label>
            <input type="text" id="prod-name" required value="${product?.name || ''}">
          </div>
          <div class="form-group full-width">
            <label>Descripción</label>
            <textarea id="prod-description" rows="2" style="width:100%; padding:12px 16px; border:2px solid var(--border-color); border-radius:var(--radius-sm); font-family:var(--font-family);">${product?.description || ''}</textarea>
          </div>
          <div class="form-group">
            <label>Categoría</label>
            <select id="prod-category">
              <option value="">Sin categoría</option>
            </select>
          </div>
          <div class="form-group">
            <label>Unidad</label>
            <select id="prod-unit">
              <option value="unidad" ${product?.unit === 'unidad' ? 'selected' : ''}>Unidad</option>
              <option value="kg" ${product?.unit === 'kg' ? 'selected' : ''}>Kilogramo</option>
              <option value="litro" ${product?.unit === 'litro' ? 'selected' : ''}>Litro</option>
              <option value="metro" ${product?.unit === 'metro' ? 'selected' : ''}>Metro</option>
              <option value="bolsa" ${product?.unit === 'bolsa' ? 'selected' : ''}>Bolsa</option>
              <option value="caja" ${product?.unit === 'caja' ? 'selected' : ''}>Caja</option>
            </select>
          </div>
          <div class="form-group">
            <label>Precio de Costo *</label>
            <input type="number" id="prod-cost" step="0.01" min="0" value="${product?.cost_price || ''}">
          </div>
          <div class="form-group">
            <label>Precio de Venta *</label>
            <input type="number" id="prod-sale" step="0.01" min="0" value="${product?.sale_price || ''}">
          </div>
          <div class="form-group">
            <label>Stock Mínimo</label>
            <input type="number" id="prod-min" step="0.01" min="0" value="${product?.min_stock || 0}">
          </div>
          <div class="form-group">
            <label>Stock Máximo</label>
            <input type="number" id="prod-max" step="0.01" min="0" value="${product?.max_stock || 0}">
          </div>
          <div class="form-group">
            <label>Tasa de Impuesto (%)</label>
            <input type="number" id="prod-tax" step="0.01" min="0" max="100" value="${product?.tax_rate ?? 15}">
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('product-modal').remove()">Cancelar</button>
        <button class="btn btn-primary" id="btn-save-product">${isEdit ? 'Guardar' : 'Crear'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Cargar categorías
  api.getCategories().then(data => {
    const select = document.getElementById('prod-category');
    select.innerHTML = '<option value="">Sin categoría</option>' +
      (data.categories || []).map(c => 
        `<option value="${c.id}" ${c.id === product?.category_id ? 'selected' : ''}>${c.name}</option>`
      ).join('');
  });

  document.getElementById('btn-save-product').addEventListener('click', async () => {
    const payload = {
      sku: document.getElementById('prod-sku').value.trim(),
      name: document.getElementById('prod-name').value.trim(),
      description: document.getElementById('prod-description').value.trim(),
      barcode: document.getElementById('prod-barcode').value.trim(),
      unit: document.getElementById('prod-unit').value,
      category_id: document.getElementById('prod-category').value || null,
      cost_price: parseFloat(document.getElementById('prod-cost').value) || 0,
      sale_price: parseFloat(document.getElementById('prod-sale').value) || 0,
      min_stock: parseFloat(document.getElementById('prod-min').value) || 0,
      max_stock: parseFloat(document.getElementById('prod-max').value) || 0,
      tax_rate: parseFloat(document.getElementById('prod-tax').value)
    };

    if (!payload.sku || !payload.name) {
      Utils.showToast('SKU y nombre son requeridos', 'error');
      return;
    }

    try {
      const btn = document.getElementById('btn-save-product');
      btn.disabled = true;
      btn.textContent = 'Guardando...';

      if (isEdit) {
        await api.updateProduct(product.id, payload);
        Utils.showToast('Producto actualizado');
      } else {
        await api.createProduct(payload);
        Utils.showToast('Producto creado');
      }

      document.getElementById('product-modal').remove();
      this.loadInventoryTab('products');
    } catch (err) {
      Utils.showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = isEdit ? 'Guardar' : 'Crear';
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
},

async editProduct(id) {
  try {
    const data = await api.getProduct(id);
    this.showProductModal(data.product);
  } catch (err) {
    Utils.showToast('Error al cargar producto', 'error');
  }
},

async deleteProduct(id, name) {
  if (!window.confirm(`¿Desactivar el producto "${name}"?`)) return;
  try {
    await api.deleteProduct(id);
    Utils.showToast('Producto desactivado');
    this.loadInventoryTab('products');
  } catch (err) {
    Utils.showToast(err.message, 'error');
  }
},

showCategoryModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'category-modal';

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>Nueva Categoría</h3>
        <button class="btn-icon" onclick="document.getElementById('category-modal').remove()"></button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Nombre *</label>
          <input type="text" id="cat-name" required>
        </div>
        <div class="form-group">
          <label>Descripción</label>
          <textarea id="cat-desc" rows="2" style="width:100%; padding:12px 16px; border:2px solid var(--border-color); border-radius:var(--radius-sm);"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('category-modal').remove()">Cancelar</button>
        <button class="btn btn-primary" id="btn-save-cat">Crear</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('btn-save-cat').addEventListener('click', async () => {
    const name = document.getElementById('cat-name').value.trim();
    const description = document.getElementById('cat-desc').value.trim();

    if (!name) {
      Utils.showToast('El nombre es requerido', 'error');
      return;
    }

    try {
      await api.createCategory({ name, description });
      Utils.showToast('Categoría creada');
      document.getElementById('category-modal').remove();
      this.loadInventoryTab('products');
    } catch (err) {
      Utils.showToast(err.message, 'error');
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
},

// ==========================================
// STOCK
// ==========================================
async loadStockView(container) {
  container.innerHTML = `
    <div class="d-flex justify-between align-center mb-3">
      <h2>Stock por Bodega</h2>
      <button class="btn btn-primary" id="btn-adjustment">${Utils.icon('scale')} Registrar Ajuste</button>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>SKU</th>
              <th>Bodega</th>
              <th>Sucursal</th>
              <th>Cantidad</th>
              <th>Valor</th>
            </tr>
          </thead>
          <tbody id="stock-table-body">
            <tr><td colspan="6" style="text-align:center; padding:40px;">Cargando...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('btn-adjustment').addEventListener('click', () => this.showAdjustmentModal());

  try {
    const data = await api.getStock();
    const tbody = document.getElementById('stock-table-body');

    if (!data.stock || data.stock.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:40px; color:var(--text-muted);">Sin stock registrado</td></tr>';
      return;
    }

    tbody.innerHTML = data.stock.map(s => `
      <tr>
        <td><strong>${s.products.name}</strong></td>
        <td>${s.products.sku}</td>
        <td>${s.warehouses.warehouse_name}</td>
        <td>${s.warehouses.branches?.branch_name || '-'}</td>
        <td><strong>${Utils.formatNumber(s.quantity)} ${s.products.unit}</strong></td>
        <td>${Utils.formatCurrency(s.quantity * s.products.cost_price)}</td>
      </tr>
    `).join('');
  } catch (err) {
    Utils.showToast('Error cargando stock', 'error');
  }
},

showAdjustmentModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'adjustment-modal';

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>Registrar Ajuste de Inventario</h3>
        <button class="btn-icon" onclick="document.getElementById('adjustment-modal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group full-width">
            <label>Tipo de Movimiento *</label>
            <select id="adj-type">
              <option value="entrada">Entrada (aumenta stock)</option>
              <option value="salida">Salida (reduce stock)</option>
              <option value="ajuste_positivo">Ajuste positivo</option>
              <option value="ajuste_negativo">Ajuste negativo</option>
            </select>
          </div>
          <div class="form-group full-width">
            <label>Producto *</label>
            <select id="adj-product" required>
              <option value="">Seleccionar producto</option>
            </select>
          </div>
          <div class="form-group full-width">
            <label>Bodega *</label>
            <select id="adj-warehouse" required>
              <option value="">Seleccionar bodega</option>
            </select>
          </div>
          <div class="form-group">
            <label>Cantidad *</label>
            <input type="number" id="adj-qty" step="0.01" min="0.01" required>
          </div>
          <div class="form-group">
            <label>Costo Unitario</label>
            <input type="number" id="adj-cost" step="0.01" min="0" value="0">
          </div>
          <div class="form-group full-width">
            <label>Notas</label>
            <textarea id="adj-notes" rows="2" style="width:100%; padding:12px 16px; border:2px solid var(--border-color); border-radius:var(--radius-sm);"></textarea>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('adjustment-modal').remove()">Cancelar</button>
        <button class="btn btn-primary" id="btn-save-adj">Registrar</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Cargar productos y bodegas
  Promise.all([api.getProducts(), api.getWarehouses()]).then(([prodData, whData]) => {
    document.getElementById('adj-product').innerHTML = 
      '<option value="">Seleccionar producto</option>' +
      (prodData.products || []).map(p => `<option value="${p.id}">${p.name} (${p.sku})</option>`).join('');
    
    document.getElementById('adj-warehouse').innerHTML = 
      '<option value="">Seleccionar bodega</option>' +
      (whData.warehouses || []).map(w => `<option value="${w.id}">${w.name} - ${w.branches?.branch_name || ''}</option>`).join('');
  });

  document.getElementById('btn-save-adj').addEventListener('click', async () => {
    const payload = {
      movement_type: document.getElementById('adj-type').value,
      product_id: document.getElementById('adj-product').value,
      warehouse_id: document.getElementById('adj-warehouse').value,
      quantity: parseFloat(document.getElementById('adj-qty').value),
      unit_cost: parseFloat(document.getElementById('adj-cost').value) || 0,
      notes: document.getElementById('adj-notes').value.trim()
    };

    if (!payload.product_id || !payload.warehouse_id || !payload.quantity) {
      Utils.showToast('Complete todos los campos requeridos', 'error');
      return;
    }

    try {
      const btn = document.getElementById('btn-save-adj');
      btn.disabled = true;
      btn.textContent = 'Registrando...';

      await api.createAdjustment(payload);
      Utils.showToast('Ajuste registrado exitosamente');
      document.getElementById('adjustment-modal').remove();
      this.loadInventoryTab('stock');
    } catch (err) {
      Utils.showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Registrar';
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
},

// ==========================================
// MOVIMIENTOS
// ==========================================
async loadMovementsView(container) {
  container.innerHTML = `
    <div class="page-header">
      <h2>Movimientos de Inventario</h2>
      <p class="text-muted">Historial de entradas, salidas y ajustes</p>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Producto</th>
              <th>Bodega</th>
              <th>Cantidad</th>
              <th>Usuario</th>
              <th>Notas</th>
            </tr>
          </thead>
          <tbody id="movements-table-body">
            <tr><td colspan="7" style="text-align:center; padding:40px;">Cargando...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  try {
    const data = await api.getMovements();
    const tbody = document.getElementById('movements-table-body');

    if (!data.movements || data.movements.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:40px; color:var(--text-muted);">Sin movimientos registrados</td></tr>';
      return;
    }

    const typeLabels = {
      'entrada': 'Entrada',
      'salida': 'Salida',
      'ajuste_positivo': 'Ajuste +',
      'ajuste_negativo': 'Ajuste -',
      'transferencia_in': 'Transferencia de entrada',
      'transferencia_out': 'Transferencia de salida'
    };

    tbody.innerHTML = data.movements.map(m => `
      <tr>
        <td>${Utils.formatDate(m.created_at)}</td>
        <td><span class="badge-status info">${typeLabels[m.movement_type] || m.movement_type}</span></td>
        <td><strong>${m.products.name}</strong><br><span class="text-muted" style="font-size:12px;">${m.products.sku}</span></td>
        <td>${m.warehouses.warehouse_name}</td>
        <td><strong>${Utils.formatNumber(m.quantity)}</strong></td>
        <td>${m.users.full_name}</td>
        <td class="text-muted">${m.notes || '-'}</td>
      </tr>
    `).join('');
  } catch (err) {
    Utils.showToast('Error cargando movimientos', 'error');
  }
},

// ==========================================
// LOTES
// ==========================================
async loadBatchesView(container) {
  container.innerHTML = `
    <div class="d-flex justify-between align-center mb-3">
      <h2>Lotes y Series</h2>
      <button class="btn btn-primary" id="btn-new-batch">${Utils.icon('tag')} Nuevo Lote</button>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>N° Lote</th>
              <th>Producto</th>
              <th>Bodega</th>
              <th>Cantidad</th>
              <th>Costo</th>
              <th>Vencimiento</th>
            </tr>
          </thead>
          <tbody id="batches-table-body">
            <tr><td colspan="6" style="text-align:center; padding:40px;">Cargando...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('btn-new-batch').addEventListener('click', () => this.showBatchModal());

  try {
    const data = await api.getBatches();
    const tbody = document.getElementById('batches-table-body');

    if (!data.batches || data.batches.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:40px; color:var(--text-muted);">Sin lotes registrados</td></tr>';
      return;
    }

    tbody.innerHTML = data.batches.map(b => {
      const isExpired = b.expiry_date && new Date(b.expiry_date) < new Date();
      return `
        <tr>
          <td><strong>${b.batch_number || 'S/N'}</strong>${b.serial_number ? `<br><span class="text-muted" style="font-size:12px;">Serie: ${b.serial_number}</span>` : ''}</td>
          <td><strong>${b.products.name}</strong><br><span class="text-muted" style="font-size:12px;">${b.products.sku}</span></td>
          <td>${b.warehouses.warehouse_name}</td>
          <td>${Utils.formatNumber(b.quantity)}</td>
          <td>${Utils.formatCurrency(b.cost_price)}</td>
          <td>
            ${b.expiry_date ? Utils.formatDate(b.expiry_date) : '-'}
            ${isExpired ? `<div style="font-size:11px; color:var(--danger);">${Utils.icon('alert')} Vencido</div>` : ''}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    Utils.showToast('Error cargando lotes', 'error');
  }
},

showBatchModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'batch-modal';

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>Nuevo Lote</h3>
        <button class="btn-icon" onclick="document.getElementById('batch-modal').remove()"></button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group full-width">
            <label>Producto *</label>
            <select id="batch-product" required>
              <option value="">Seleccionar producto</option>
            </select>
          </div>
          <div class="form-group full-width">
            <label>Bodega *</label>
            <select id="batch-warehouse" required>
              <option value="">Seleccionar bodega</option>
            </select>
          </div>
          <div class="form-group">
            <label>N° de Lote</label>
            <input type="text" id="batch-number" placeholder="Ej: LOTE-2026-001">
          </div>
          <div class="form-group">
            <label>N° de Serie</label>
            <input type="text" id="batch-serial">
          </div>
          <div class="form-group">
            <label>Cantidad *</label>
            <input type="number" id="batch-qty" step="0.01" min="0.01" required>
          </div>
          <div class="form-group">
            <label>Costo Unitario</label>
            <input type="number" id="batch-cost" step="0.01" min="0" value="0">
          </div>
          <div class="form-group full-width">
            <label>Fecha de Vencimiento</label>
            <input type="date" id="batch-expiry">
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('batch-modal').remove()">Cancelar</button>
        <button class="btn btn-primary" id="btn-save-batch">Crear Lote</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  Promise.all([api.getProducts(), api.getWarehouses()]).then(([prodData, whData]) => {
    document.getElementById('batch-product').innerHTML = 
      '<option value="">Seleccionar producto</option>' +
      (prodData.products || []).map(p => `<option value="${p.id}">${p.name} (${p.sku})</option>`).join('');
    
    document.getElementById('batch-warehouse').innerHTML = 
      '<option value="">Seleccionar bodega</option>' +
      (whData.warehouses || []).map(w => `<option value="${w.id}">${w.name}</option>`).join('');
  });

  document.getElementById('btn-save-batch').addEventListener('click', async () => {
    const payload = {
      product_id: document.getElementById('batch-product').value,
      warehouse_id: document.getElementById('batch-warehouse').value,
      batch_number: document.getElementById('batch-number').value.trim(),
      serial_number: document.getElementById('batch-serial').value.trim(),
      quantity: parseFloat(document.getElementById('batch-qty').value),
      cost_price: parseFloat(document.getElementById('batch-cost').value) || 0,
      expiry_date: document.getElementById('batch-expiry').value || null
    };

    if (!payload.product_id || !payload.warehouse_id || !payload.quantity) {
      Utils.showToast('Complete los campos requeridos', 'error');
      return;
    }

    try {
      const btn = document.getElementById('btn-save-batch');
      btn.disabled = true;
      btn.textContent = 'Creando...';

      await api.createBatch(payload);
      Utils.showToast('Lote creado exitosamente');
      document.getElementById('batch-modal').remove();
      this.loadInventoryTab('batches');
    } catch (err) {
      Utils.showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Crear Lote';
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
},

// ==========================================
// BODEGAS
// ==========================================
async loadWarehousesView(container) {
  container.innerHTML = `
    <div class="d-flex justify-between align-center mb-3">
      <h2>Bodegas</h2>
      <button class="btn btn-primary" id="btn-new-warehouse"> Nueva Bodega</button>
    </div>
    <div id="warehouses-grid" class="kpi-grid">
      <div style="text-align:center; padding:40px; grid-column:1/-1;">Cargando...</div>
    </div>
  `;

  document.getElementById('btn-new-warehouse').addEventListener('click', () => this.showWarehouseModal());

  try {
    const data = await api.getWarehouses();
    const grid = document.getElementById('warehouses-grid');

    if (!data.warehouses || data.warehouses.length === 0) {
      grid.innerHTML = '<div style="text-align:center; padding:40px; grid-column:1/-1; color:var(--text-muted);">Sin bodegas registradas</div>';
      return;
    }

    grid.innerHTML = data.warehouses.map(w => `
      <div class="kpi-card">
        <div class="d-flex justify-between align-center mb-2">
          <span class="badge-status success">Activa</span>
          <span style="font-size:12px; color:var(--text-muted);">${w.branches?.branch_code || ''}</span>
        </div>
        <div style="font-size:20px; font-weight:700; margin-bottom:8px;">${w.name}</div>
        <div style="font-size:13px; color:var(--text-muted); margin-bottom:4px;">${Utils.icon('building')} ${w.branches?.branch_name || '-'}</div>
        <div style="font-size:13px; color:var(--text-muted);">${Utils.icon('location')} ${w.location || 'Sin ubicación'}</div>
      </div>
    `).join('');
  } catch (err) {
    Utils.showToast('Error cargando bodegas', 'error');
  }
},

showWarehouseModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'warehouse-modal';

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>Nueva Bodega</h3>
        <button class="btn-icon" onclick="document.getElementById('warehouse-modal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group full-width">
            <label>Sucursal *</label>
            <select id="wh-branch" required>
              <option value="">Seleccionar sucursal</option>
            </select>
          </div>
          <div class="form-group full-width">
            <label>Nombre *</label>
            <input type="text" id="wh-name" required placeholder="Ej: Bodega Principal">
          </div>
          <div class="form-group full-width">
            <label>Ubicación</label>
            <input type="text" id="wh-location" placeholder="Ej: Almacén central, zona A">
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('warehouse-modal').remove()">Cancelar</button>
        <button class="btn btn-primary" id="btn-save-wh">Crear Bodega</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Cargar sucursales
  api.getBranches({ is_active: 'true' }).then(data => {
    document.getElementById('wh-branch').innerHTML = 
      '<option value="">Seleccionar sucursal</option>' +
      (data.branches || []).map(b => `<option value="${b.id}">${b.name} (${b.code})</option>`).join('');
  });

  document.getElementById('btn-save-wh').addEventListener('click', async () => {
    const payload = {
      branch_id: document.getElementById('wh-branch').value,
      name: document.getElementById('wh-name').value.trim(),
      location: document.getElementById('wh-location').value.trim()
    };

    if (!payload.branch_id || !payload.name) {
      Utils.showToast('Sucursal y nombre son requeridos', 'error');
      return;
    }

    try {
      const btn = document.getElementById('btn-save-wh');
      btn.disabled = true;
      btn.textContent = 'Creando...';

      await api.createWarehouse(payload);
      Utils.showToast('Bodega creada');
      document.getElementById('warehouse-modal').remove();
      this.loadInventoryTab('warehouses');
    } catch (err) {
      Utils.showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Crear Bodega';
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
},
// ==========================================
// CONTACTOS (CU-14, CU-16)
// ==========================================
async loadContacts(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Contactos</h1>
      <p class="text-muted">Gestión de clientes y proveedores</p>
    </div>

    <!-- KPIs -->
    <div class="kpi-grid" id="contacts-kpis">
      <div class="kpi-card">
        <div class="kpi-label">Total Clientes</div>
        <div class="kpi-value" id="kpi-clients">-</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Proveedores</div>
        <div class="kpi-value" id="kpi-suppliers">-</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Cuentas por Cobrar</div>
        <div class="kpi-value text-orange" id="kpi-receivable">-</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Cuentas por Pagar</div>
        <div class="kpi-value text-purple" id="kpi-payable">-</div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="card mb-3">
      <div class="card-body" style="padding:12px 24px;">
        <div class="d-flex gap-1" style="flex-wrap:wrap;">
          <button class="btn btn-primary contact-tab" data-tab="all"> Todos</button>
          <button class="btn btn-secondary contact-tab" data-tab="cliente">${Utils.icon('users')} Clientes</button>
          <button class="btn btn-secondary contact-tab" data-tab="proveedor">${Utils.icon('building')} Proveedores</button>
        </div>
      </div>
    </div>

    <!-- Filtros y acciones -->
    <div class="card mb-3">
      <div class="card-body">
        <div class="d-flex gap-2">
          <input type="text" id="search-contacts" placeholder="Buscar por nombre, documento, email o teléfono..."
            style="flex:1; padding:10px 16px; border:2px solid var(--border-color); border-radius:var(--radius-sm);">
          <button class="btn btn-primary" id="btn-new-contact">${Utils.icon('plus')} Nuevo Contacto</button>
        </div>
      </div>
    </div>

    <!-- Tabla -->
    <div class="card">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Documento</th>
              <th>Nombre / Razón Social</th>
              <th>Contacto</th>
              <th>Saldo</th>
              <th>Límite Crédito</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody id="contacts-table-body">
            <tr><td colspan="8" style="text-align:center; padding:40px;">Cargando...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Cargar estadísticas
  this.loadContactStats();

  // Manejar tabs
  let currentTab = 'all';
  container.querySelectorAll('.contact-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.contact-tab').forEach(b => {
        b.className = 'btn btn-secondary contact-tab';
      });
      btn.className = 'btn btn-primary contact-tab';
      currentTab = btn.dataset.tab;
      loadContactsList();
    });
  });

  document.getElementById('btn-new-contact').addEventListener('click', () => this.showContactModal());

  const searchInput = document.getElementById('search-contacts');

  const loadContactsList = async () => {
    const params = {};
    if (currentTab !== 'all') params.type = currentTab;
    if (searchInput.value) params.search = searchInput.value;

    try {
      const data = await api.getContacts(params);
      this.renderContactsTable(data.contacts || []);
    } catch (err) {
      Utils.showToast('Error cargando contactos', 'error');
    }
  };

  searchInput.addEventListener('input', Utils.debounce(loadContactsList, 300));

  await loadContactsList();
},

async loadContactStats() {
  try {
    const data = await api.getContactStats();
    document.getElementById('kpi-clients').textContent = data.clients.total;
    document.getElementById('kpi-suppliers').textContent = data.suppliers.total;
    document.getElementById('kpi-receivable').textContent = Utils.formatCurrency(data.clients.balance_total);
    document.getElementById('kpi-payable').textContent = Utils.formatCurrency(data.suppliers.balance_total);
  } catch (err) {
    console.error('Error cargando stats:', err);
  }
},

renderContactsTable(contacts) {
  const tbody = document.getElementById('contacts-table-body');

  if (contacts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:40px; color:var(--text-muted);">No se encontraron contactos</td></tr>';
    return;
  }

  tbody.innerHTML = contacts.map(c => {
    const isClient = c.type === 'cliente';
    const balanceClass = parseFloat(c.balance) > 0 ? 'text-danger fw-bold' : 'text-success';
    const creditPercent = c.credit_limit > 0 ? (c.balance / c.credit_limit) * 100 : 0;
    const creditClass = creditPercent > 80 ? 'text-danger' : creditPercent > 50 ? 'text-warning' : '';

    return `
      <tr>
        <td>
          <span class="badge-status ${isClient ? 'info' : 'warning'}">
            ${isClient ? `${Utils.icon('user')} Cliente` : `${Utils.icon('building')} Proveedor`}
          </span>
        </td>
        <td>
          <div style="font-weight:600;">${c.document_number || '-'}</div>
          <div class="text-muted" style="font-size:11px; text-transform:uppercase;">${c.document_type || '-'}</div>
        </td>
        <td>
          <div style="font-weight:600;">${c.name}</div>
          ${c.business_name ? `<div class="text-muted" style="font-size:12px;">${c.business_name}</div>` : ''}
        </td>
        <td>
          ${c.email ? `<div>${c.email}</div>` : ''}
          ${c.phone ? `<div class="text-muted" style="font-size:12px;">${c.phone}</div>` : ''}
        </td>
        <td class="${balanceClass}">${Utils.formatCurrency(c.balance)}</td>
        <td class="${creditClass}">
          ${c.credit_limit > 0 ? Utils.formatCurrency(c.credit_limit) : '-'}
          ${c.credit_limit > 0 ? `<div style="font-size:11px;">${creditPercent.toFixed(0)}% usado</div>` : ''}
        </td>
        <td>
          <span class="badge-status ${c.is_active ? 'success' : 'danger'}">
            ${c.is_active ? 'Activo' : 'Inactivo'}
          </span>
        </td>
        <td>
          <div class="d-flex gap-1">
            <button class="btn btn-sm btn-secondary" onclick="App.editContact('${c.id}')">️</button>
            <button class="btn btn-sm btn-danger" aria-label="Desactivar contacto" title="Desactivar contacto" onclick="App.deleteContact('${c.id}', '${c.name.replace(/'/g, "\\'")}')">${Utils.icon('trash')}</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
},

showContactModal(contact = null) {
  const isEdit = !!contact;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'contact-modal';

  overlay.innerHTML = `
    <div class="modal" style="max-width:700px;">
      <div class="modal-header">
        <h3>${isEdit ? 'Editar Contacto' : 'Nuevo Contacto'}</h3>
        <button class="btn-icon" onclick="document.getElementById('contact-modal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group full-width">
            <label>Tipo *</label>
            <select id="contact-type" required ${isEdit ? 'disabled' : ''}>
              <option value="cliente" ${contact?.type === 'cliente' ? 'selected' : ''}>Cliente</option>
              <option value="proveedor" ${contact?.type === 'proveedor' ? 'selected' : ''}>Proveedor</option>
            </select>
          </div>
          <div class="form-group">
            <label>Tipo de Documento</label>
            
            <select id="contact-doc-type">
             <option value="cedula" ${contact?.document_type === 'cedula' ? 'selected' : ''}>Cédula nicaragüense</option>
             <option value="ruc" ${contact?.document_type === 'ruc' ? 'selected' : ''}>RUC</option>
             <option value="pasaporte" ${contact?.document_type === 'pasaporte' ? 'selected' : ''}>Pasaporte</option>
             <option value="otro" ${contact?.document_type === 'otro' ? 'selected' : ''}>Otro</option>
            </select>

          </div>
          <div class="form-group">
            <label>N° de Documento</label>
            <input type="text" id="contact-doc-number" value="${contact?.document_number || ''}" placeholder="Ej: 12345678">
          </div>
          <div class="form-group full-width">
            <label>Nombre / Razón Social *</label>
            <input type="text" id="contact-name" required value="${contact?.name || ''}">
          </div>
          <div class="form-group full-width">
            <label>Nombre Comercial (opcional)</label>
            <input type="text" id="contact-business" value="${contact?.business_name || ''}" placeholder="Nombre comercial o razón social">
          </div>
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="contact-email" value="${contact?.email || ''}">
          </div>
          <div class="form-group">
            <label>Teléfono</label>
            <input type="text" id="contact-phone" value="${contact?.phone || ''}" placeholder="+505 1234-5678">
          </div>
          <div class="form-group full-width">
            <label>Dirección</label>
            <input type="text" id="contact-address" value="${contact?.address || ''}">
          </div>
          <div class="form-group">
            <label>Límite de Crédito (C$)</label>
            <input type="number" id="contact-credit" step="0.01" min="0" value="${contact?.credit_limit || 0}">
          </div>
          <div class="form-group">
            <label>Saldo Actual (C$)</label>
            <input type="number" id="contact-balance" step="0.01" value="${contact?.balance || 0}">
          </div>
          <div class="form-group full-width">
            <label>Notas</label>
            <textarea id="contact-notes" rows="2" style="width:100%; padding:12px 16px; border:2px solid var(--border-color); border-radius:var(--radius-sm); font-family:var(--font-family);">${contact?.notes || ''}</textarea>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('contact-modal').remove()">Cancelar</button>
        <button class="btn btn-primary" id="btn-save-contact">${isEdit ? 'Guardar' : 'Crear'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('btn-save-contact').addEventListener('click', async () => {
    const payload = {
      type: document.getElementById('contact-type').value,
      document_type: document.getElementById('contact-doc-type').value,
      document_number: document.getElementById('contact-doc-number').value.trim(),
      name: document.getElementById('contact-name').value.trim(),
      business_name: document.getElementById('contact-business').value.trim(),
      email: document.getElementById('contact-email').value.trim(),
      phone: document.getElementById('contact-phone').value.trim(),
      address: document.getElementById('contact-address').value.trim(),
      credit_limit: parseFloat(document.getElementById('contact-credit').value) || 0,
      balance: parseFloat(document.getElementById('contact-balance').value) || 0,
      notes: document.getElementById('contact-notes').value.trim()
    };

    if (!payload.name) {
      Utils.showToast('El nombre es requerido', 'error');
      return;
    }

    try {
      const btn = document.getElementById('btn-save-contact');
      btn.disabled = true;
      btn.textContent = 'Guardando...';

      if (isEdit) {
        await api.updateContact(contact.id, payload);
        Utils.showToast('Contacto actualizado');
      } else {
        await api.createContact(payload);
        Utils.showToast('Contacto creado');
      }

      document.getElementById('contact-modal').remove();
      this.loadContacts(document.getElementById('page-content'));
    } catch (err) {
      Utils.showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = isEdit ? 'Guardar' : 'Crear';
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
},

async editContact(id) {
  try {
    const data = await api.getContact(id);
    this.showContactModal(data.contact);
  } catch (err) {
    Utils.showToast('Error al cargar contacto', 'error');
  }
},

async deleteContact(id, name) {
  if (!window.confirm(`¿Desactivar el contacto "${name}"?`)) return;
  try {
    await api.deleteContact(id);
    Utils.showToast('Contacto desactivado');
    this.loadContacts(document.getElementById('page-content'));
  } catch (err) {
    Utils.showToast(err.message, 'error');
  }
},
// ==========================================
// PUNTO DE VENTA (POS) - CU-08
// ==========================================
async loadPOS(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Punto de Venta</h1>
      <p class="text-muted">Registro rápido de ventas</p>
    </div>

    <div style="display:grid; grid-template-columns: 2fr 1fr; gap:24px;">
      <!-- Panel izquierdo: Búsqueda y productos -->
      <div>
        <div class="card mb-3">
          <div class="card-body">
            <input type="text" id="pos-search" placeholder="Buscar producto por nombre, SKU o código de barras..."
              style="width:100%; padding:14px 16px; border:2px solid var(--border-color); border-radius:var(--radius-sm); font-size:15px;">
          </div>
        </div>

        <div id="pos-products" class="kpi-grid" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));">
          <div style="text-align:center; padding:40px; grid-column:1/-1; color:var(--text-muted);">
            Cargando productos...
          </div>
        </div>
      </div>

      <!-- Panel derecho: Ticket -->
      <div>
        <div class="card" style="position:sticky; top:80px;">
          <div class="card-header">
            <h3>${Utils.icon('receipt')} Ticket de Venta</h3>
            <span id="pos-items-count" class="badge-status info">0 items</span>
          </div>
          <div class="card-body" style="padding:16px;">
            <div class="form-group" style="margin-bottom:12px;">
              <label for="pos-warehouse">Bodega de salida</label>
              <select id="pos-warehouse" style="width:100%; padding:8px 12px; border:2px solid var(--border-color); border-radius:var(--radius-sm);">
                <option value="">Cargando bodegas...</option>
              </select>
            </div>
            <div class="form-group" style="margin-bottom:12px;">
              <label>Cliente (opcional)</label>
              <select id="pos-client" style="width:100%; padding:8px 12px; border:2px solid var(--border-color); border-radius:var(--radius-sm);">
                <option value="">Cliente general</option>
              </select>
            </div>

            <div id="pos-ticket-items" style="max-height:300px; overflow-y:auto; margin-bottom:16px;">
              <div style="text-align:center; padding:20px; color:var(--text-muted); font-size:13px;">
                Sin productos agregados
              </div>
            </div>

            <div style="border-top:2px solid var(--border-color); padding-top:12px;">
              <div class="d-flex justify-between mb-1">
                <span class="text-muted">Subtotal:</span>
                <span id="pos-subtotal">${Utils.formatCurrency(0)}</span>
              </div>
              <div class="d-flex justify-between mb-1">
                <span class="text-muted">IVA:</span>
                <span id="pos-tax">${Utils.formatCurrency(0)}</span>
              </div>
              <div class="d-flex justify-between mb-2" style="font-size:13px;">
                <span class="text-muted">Descuento:</span>
                <input type="number" id="pos-discount" value="0" min="0" step="0.01"
                  style="width:100px; padding:4px 8px; border:1px solid var(--border-color); border-radius:4px; text-align:right;">
              </div>
              <div class="d-flex justify-between" style="font-size:20px; font-weight:800; color:var(--primary);">
                <span>TOTAL:</span>
                <span id="pos-total">${Utils.formatCurrency(0)}</span>
              </div>
            </div>

            <div style="margin-top:16px; display:flex; flex-direction:column; gap:8px;">
              <button class="btn btn-primary btn-full" id="btn-pos-pay" disabled>${Utils.icon('wallet')} Cobrar (F2)</button>
              <button class="btn btn-secondary btn-full" id="btn-pos-clear">${Utils.icon('trash')} Limpiar</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  this.posItems = [];
  this.posProductsCache = [];
  const searchInput = document.getElementById('pos-search');
  const productsContainer = document.getElementById('pos-products');
  const warehouseSelect = document.getElementById('pos-warehouse');
  const branchId = this.user?.branch?.id || this.user?.branch_id;

  // Cargar clientes
  try {
    const clientsData = await api.getContacts({ type: 'cliente' });
    const clientSelect = document.getElementById('pos-client');
    clientSelect.innerHTML = '<option value="">Cliente general</option>' +
      (clientsData.contacts || []).map(c =>
        `<option value="${c.id}">${c.name} - ${c.document_number || 'S/D'}</option>`
      ).join('');
  } catch (err) { console.error(err); }

  try {
    if (!branchId) throw new Error('Tu usuario no tiene una sucursal asignada.');
    const warehouseData = await api.getWarehouses({ branch_id: branchId });
    const warehouses = (warehouseData.warehouses || []).filter(warehouse =>
      warehouse.is_active !== false && warehouse.branch_id === branchId
    );
    warehouseSelect.innerHTML = '<option value="">Seleccionar bodega</option>';
    warehouses.forEach(warehouse => {
      const option = document.createElement('option');
      option.value = warehouse.id;
      option.textContent = warehouse.name;
      warehouseSelect.appendChild(option);
    });
    if (warehouses.length === 1) warehouseSelect.value = warehouses[0].id;
    if (!warehouses.length) {
      warehouseSelect.innerHTML = '<option value="">No hay bodegas activas</option>';
    }
  } catch (err) {
    console.error('Error cargando bodegas del punto de venta:', err);
    warehouseSelect.innerHTML = '<option value="">No se pudieron cargar las bodegas</option>';
    Utils.showToast(err.message || 'No se pudieron cargar las bodegas del punto de venta', 'error');
  }

  // Cargar productos
  try {
    const prodData = await api.getProducts({ is_active: 'true' });
    this.posProductsCache = (prodData.products || []).filter(product => product.is_active !== false);
    this.renderPOSProducts();
  } catch (err) {
    console.error('Error cargando productos para el punto de venta:', err);
    productsContainer.innerHTML = '<div style="text-align:center; padding:40px; grid-column:1/-1; color:var(--danger);"></div>';
    productsContainer.firstElementChild.textContent =
      `No se pudieron cargar los productos. ${err.message || 'Intenta nuevamente.'}`;
    Utils.showToast('No se pudieron cargar los productos del punto de venta', 'error');
  }

  searchInput.addEventListener('input', Utils.debounce(() => {
    this.renderPOSProducts(searchInput.value);
  }, 200));
  warehouseSelect.addEventListener('change', () => this.renderPOSProducts(searchInput.value));

  productsContainer.addEventListener('click', event => {
    const button = event.target.closest('[data-pos-product]');
    if (button && !button.disabled) this.addToPOS(button.dataset.posProduct);
  });

  document.getElementById('btn-pos-clear').addEventListener('click', () => {
    this.posItems = [];
    this.renderPOSTicket();
    searchInput.value = '';
    this.renderPOSProducts();
  });

  document.getElementById('btn-pos-pay').addEventListener('click', () => this.showPaymentModal());

  document.getElementById('pos-discount').addEventListener('input', () => this.renderPOSTicket());

  // Atajo F2 para cobrar
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F2' && this.posItems.length > 0) {
      e.preventDefault();
      this.showPaymentModal();
    }
  });
},

renderPOSProducts(searchTerm = '') {
  const productsContainer = document.getElementById('pos-products');
  if (!productsContainer) return;
  const warehouseId = document.getElementById('pos-warehouse')?.value;

  if (!warehouseId) {
    productsContainer.innerHTML = `
      <div style="text-align:center; padding:40px; grid-column:1/-1; color:var(--text-muted);">
        Selecciona una bodega para ver sus productos disponibles.
      </div>
    `;
    return;
  }

  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
  const query = String(searchTerm).trim().toLowerCase();
  const matching = this.posProductsCache.map(product => ({
    ...product,
    warehouseStock: (product.warehouses || [])
      .filter(stock => stock.warehouse_id === warehouseId)
      .reduce((sum, stock) => sum + Number(stock.quantity || 0), 0)
  })).filter(product => {
    const searchable = [product.name, product.sku, product.barcode]
      .map(value => String(value || '').toLowerCase());
    return !query || searchable.some(value => value.includes(query));
  });

  matching.sort((a, b) => {
    const stockDifference = b.warehouseStock - a.warehouseStock;
    return stockDifference || String(a.name || '').localeCompare(String(b.name || ''), 'es');
  });

  const products = query
    ? matching
    : matching.filter(product => product.warehouseStock > 0).slice(0, 12);

  if (!products.length) {
    const message = query
      ? 'No se encontraron productos con ese nombre, SKU o código de barras.'
      : 'No hay productos con existencias en esta bodega. Selecciona otra bodega o registra una entrada.';
    productsContainer.innerHTML = `
      <div style="text-align:center; padding:40px; grid-column:1/-1; color:var(--text-muted);">
        ${message}
      </div>
    `;
    return;
  }

  productsContainer.innerHTML = `
    <div style="grid-column:1/-1; color:var(--text-muted); font-size:13px;">
      ${query ? 'Resultados de búsqueda' : 'Productos recomendados'}
    </div>
    ${products.map(product => {
      const stock = product.warehouseStock;
      const available = stock > 0;
      return `
        <div class="kpi-card pos-product-card" style="padding:16px; display:flex; flex-direction:column;">
          <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">${escapeHTML(product.sku || 'Sin SKU')}</div>
          <div style="font-weight:700; font-size:14px; margin-bottom:8px; min-height:40px;">${escapeHTML(product.name || 'Producto sin nombre')}</div>
          <div style="font-size:18px; font-weight:800; color:var(--primary);">${escapeHTML(Utils.formatCurrency(product.sale_price))}</div>
          <div style="font-size:11px; color:var(--text-muted); margin:4px 0 12px;">
            ${available ? `Disponible: ${escapeHTML(Utils.formatNumber(stock))} ${escapeHTML(product.unit || '')}` : 'Sin existencias'}
          </div>
          <button class="btn btn-primary btn-sm" data-pos-product="${escapeHTML(product.id)}" ${available ? '' : 'disabled'}>
            ${available ? `${Utils.icon('cart')} Agregar` : 'No disponible'}
          </button>
        </div>
      `;
    }).join('')}
  `;
},

addToPOS(productId) {
  const product = this.posProductsCache.find(p => p.id === productId);
  if (!product) return;
  const warehouseId = document.getElementById('pos-warehouse')?.value;
  if (!warehouseId) {
    Utils.showToast('Selecciona una bodega antes de agregar productos', 'error');
    return;
  }
  const stock = (product.warehouses || [])
    .filter(row => row.warehouse_id === warehouseId)
    .reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  if (stock <= 0) {
    Utils.showToast('Este producto no tiene existencias disponibles', 'error');
    return;
  }

  const existing = this.posItems.find(i => i.product_id === productId);
  if (existing) {
    if (existing.quantity >= stock) {
      Utils.showToast('Stock insuficiente', 'error');
      return;
    }
    existing.quantity += 1;
  } else {
    this.posItems.push({
      product_id: product.id,
      name: product.name,
      sku: product.sku,
      unit_price: parseFloat(product.sale_price),
      tax_rate: parseFloat(product.tax_rate ?? 15),
      quantity: 1,
      max_stock: stock,
      unit: product.unit
    });
  }

  this.renderPOSTicket();
  Utils.showToast(`${product.name} agregado`);
},

removeFromPOS(productId) {
  this.posItems = this.posItems.filter(i => i.product_id !== productId);
  this.renderPOSTicket();
},

updatePOSQuantity(productId, delta) {
  const item = this.posItems.find(i => i.product_id === productId);
  if (!item) return;

  const newQty = item.quantity + delta;
  if (newQty <= 0) {
    this.removeFromPOS(productId);
    return;
  }
  if (newQty > item.max_stock) {
    Utils.showToast('Stock insuficiente', 'error');
    return;
  }

  item.quantity = newQty;
  this.renderPOSTicket();
},

renderPOSTicket() {
  const container = document.getElementById('pos-ticket-items');
  const countEl = document.getElementById('pos-items-count');
  const subtotalEl = document.getElementById('pos-subtotal');
  const taxEl = document.getElementById('pos-tax');
  const totalEl = document.getElementById('pos-total');
  const payBtn = document.getElementById('btn-pos-pay');
  const warehouseSelect = document.getElementById('pos-warehouse');
  if (warehouseSelect) warehouseSelect.disabled = this.posItems.length > 0;

  if (this.posItems.length === 0) {
    container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:13px;">Sin productos agregados</div>';
    countEl.textContent = '0 items';
    subtotalEl.textContent = Utils.formatCurrency(0);
    taxEl.textContent = Utils.formatCurrency(0);
    totalEl.textContent = Utils.formatCurrency(0);
    payBtn.disabled = true;
    return;
  }

  payBtn.disabled = false;
  countEl.textContent = `${this.posItems.length} item${this.posItems.length > 1 ? 's' : ''}`;

  let subtotal = 0;
  let taxTotal = 0;

  container.innerHTML = this.posItems.map(item => {
    const itemSubtotal = item.quantity * item.unit_price;
    const itemTax = itemSubtotal * (item.tax_rate / 100);
    subtotal += itemSubtotal;
    taxTotal += itemTax;

    return `
      <div style="padding:10px 0; border-bottom:1px solid var(--border-light);">
        <div style="font-weight:600; font-size:13px;">${item.name}</div>
        <div style="font-size:11px; color:var(--text-muted);">${item.sku} - ${Utils.formatCurrency(item.unit_price)}</div>
        <div class="d-flex justify-between align-center mt-1">
          <div class="d-flex align-center gap-1">
            <button class="btn btn-sm btn-secondary" onclick="App.updatePOSQuantity('${item.product_id}', -1)" style="padding:2px 8px;">-</button>
            <span style="font-weight:700; min-width:30px; text-align:center;">${item.quantity}</span>
            <button class="btn btn-sm btn-secondary" onclick="App.updatePOSQuantity('${item.product_id}', 1)" style="padding:2px 8px;">+</button>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <strong>${Utils.formatCurrency(itemSubtotal + itemTax)}</strong>
            <button class="btn-icon" aria-label="Quitar producto" title="Quitar producto" onclick="App.removeFromPOS('${item.product_id}')" style="font-size:14px; color:var(--danger);">${Utils.icon('trash')}</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const discount = parseFloat(document.getElementById('pos-discount')?.value || 0);
  const total = subtotal + taxTotal - discount;

  subtotalEl.textContent = Utils.formatCurrency(subtotal);
  taxEl.textContent = Utils.formatCurrency(taxTotal);
  totalEl.textContent = Utils.formatCurrency(total);
},

showPaymentModal() {
  if (this.posItems.length === 0) return;
  const warehouseId = document.getElementById('pos-warehouse')?.value;
  if (!warehouseId) {
    Utils.showToast('Selecciona una bodega antes de cobrar la venta', 'error');
    return;
  }

  const discount = parseFloat(document.getElementById('pos-discount')?.value || 0);
  let subtotal = 0;
  let taxTotal = 0;
  this.posItems.forEach(item => {
    subtotal += item.quantity * item.unit_price;
    taxTotal += (item.quantity * item.unit_price) * (item.tax_rate / 100);
  });
  const total = subtotal + taxTotal - discount;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'payment-modal';

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>${Utils.icon('wallet')} Procesar Pago</h3>
        <button class="btn-icon" onclick="document.getElementById('payment-modal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div style="text-align:center; padding:20px; background:var(--primary-bg); border-radius:var(--radius-md); margin-bottom:20px;">
          <div style="font-size:13px; color:var(--text-muted);">Total a cobrar</div>
          <div style="font-size:36px; font-weight:800; color:var(--primary);">${Utils.formatCurrency(total)}</div>
        </div>

        <div class="form-grid">
          <div class="form-group full-width">
            <label>Método de Pago</label>
            <select id="pay-method">
              <option value="efectivo"> Efectivo</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="transferencia">Transferencia</option>
              <option value="yape">Billetera digital</option>
              <option value="credito">Crédito</option>
            </select>
          </div>
          <div class="form-group full-width">
            <label>Monto Recibido</label>
            <input type="number" id="pay-amount" step="0.01" min="0" value="${total.toFixed(2)}">
          </div>
          <div class="form-group full-width" id="pay-change-group">
            <label>Vuelto</label>
            <div id="pay-change" style="font-size:24px; font-weight:800; color:var(--success); padding:12px; background:var(--success-light); border-radius:var(--radius-sm); text-align:center;">${Utils.formatCurrency(0)}</div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('payment-modal').remove()">Cancelar</button>
        <button class="btn btn-primary" id="btn-confirm-pay" style="font-size:16px; padding:12px 32px;">${Utils.icon('check')} Confirmar Venta</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const amountInput = document.getElementById('pay-amount');
  const changeDiv = document.getElementById('pay-change');

  amountInput.addEventListener('input', () => {
    const received = parseFloat(amountInput.value) || 0;
    const change = received - total;
    changeDiv.textContent = Utils.formatCurrency(Math.max(0, change));
    changeDiv.style.color = change >= 0 ? 'var(--success)' : 'var(--danger)';
  });

  document.getElementById('btn-confirm-pay').addEventListener('click', async () => {
    const method = document.getElementById('pay-method').value;
    const received = parseFloat(amountInput.value) || 0;

    if (method !== 'credito' && received < total) {
      Utils.showToast('El monto recibido es insuficiente', 'error');
      return;
    }

    try {
      const btn = document.getElementById('btn-confirm-pay');
      btn.disabled = true;
      btn.textContent = 'Procesando...';

      const invoiceData = {
        contact_id: document.getElementById('pos-client').value || null,
        warehouse_id: document.getElementById('pos-warehouse').value,
        status: 'emitida',
        items: this.posItems.map(i => ({
          product_id: i.product_id,
          description: i.name,
          quantity: i.quantity,
          unit_price: i.unit_price,
          tax_rate: i.tax_rate
        })),
        discount,
        paid_amount: method === 'credito' ? 0 : received,
        payment_method: method
      };

      const result = await api.createInvoice(invoiceData);

      Utils.showToast(`Venta registrada: ${result.invoice.invoice_number}`);
      document.getElementById('payment-modal').remove();

      const soldQuantities = new Map(
        this.posItems.map(item => [item.product_id, item.quantity])
      );
      this.posProductsCache.forEach(product => {
        const soldQuantity = soldQuantities.get(product.id);
        if (!soldQuantity) return;
        const stockRow = (product.warehouses || []).find(
          row => row.warehouse_id === warehouseId
        );
        if (stockRow) stockRow.quantity = Math.max(0, Number(stockRow.quantity) - soldQuantity);
        product.total_stock = Math.max(0, Number(product.total_stock || 0) - soldQuantity);
      });

      // Limpiar POS
      this.posItems = [];
      this.renderPOSTicket();
      document.getElementById('pos-search').value = '';
      document.getElementById('pos-discount').value = 0;
      this.renderPOSProducts();
    } catch (err) {
      Utils.showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Confirmar Venta';
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
},

// ==========================================
// FACTURACIÓN (CU-08 a CU-12)
// ==========================================
async loadSales(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Facturación y Notas</h1>
      <p class="text-muted">Gestión de facturas, cotizaciones y notas</p>
    </div>

    <div class="card mb-3">
      <div class="card-body" style="padding:12px 24px;">
        <div class="d-flex gap-1" style="flex-wrap:wrap;">
          <button class="btn btn-primary sales-tab" data-tab="invoices">${Utils.icon('receipt')} Facturas</button>
          <button class="btn btn-secondary sales-tab" data-tab="quotes">${Utils.icon('file')} Cotizaciones</button>
          <button class="btn btn-secondary sales-tab" data-tab="accounts-receivable">${Utils.icon('file-plus')} Cuentas por Cobrar</button>
          <button class="btn btn-secondary sales-tab" data-tab="delivery-notes">${Utils.icon('delivery')} Notas de Entrega</button>
          <button class="btn btn-secondary sales-tab" data-tab="purchase-invoices">${Utils.icon('package')} Facturas de Compra</button>
        </div>
      </div>
    </div>

    <div id="sales-content"></div>
  `;

  container.querySelectorAll('.sales-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.sales-tab').forEach(b => {
        b.className = 'btn btn-secondary sales-tab';
      });
      btn.className = 'btn btn-primary sales-tab';
      this.loadSalesTab(btn.dataset.tab);
    });
  });

  this.loadSalesTab('invoices');
},

async loadSalesTab(tab) {
  const content = document.getElementById('sales-content');
  content.innerHTML = '<div class="spinner"></div>';

  try {
    switch (tab) {
      case 'invoices': await this.loadInvoicesView(content); break;
      case 'purchase-invoices': await this.loadPurchaseInvoicesView(content); break;
      case 'quotes': await this.loadQuotesView(content); break;
      case 'accounts-receivable': await this.loadAccountsReceivableView(content); break;
      case 'delivery-notes': await this.loadDeliveryNotesView(content); break;
    }
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
  }
},

async loadAccountsReceivableView(container) {
  container.innerHTML = `
    <div class="receivables-header">
      <div>
        <h2>Cuentas por Cobrar</h2>
        <p class="text-muted">Seguimiento de facturas con saldo pendiente de pago.</p>
      </div>
      <div class="receivables-total-card">
        <span class="receivables-total-label">${Utils.icon('clock')} Saldo pendiente total</span>
        <strong class="receivables-total-value" id="receivables-total">${Utils.formatCurrency(0)}</strong>
      </div>
    </div>
    <div class="card">
      <div class="table-container">
        <table class="receivables-table">
          <thead>
            <tr>
              <th>Factura</th>
              <th>Cliente</th>
              <th>Emisión</th>
              <th>Vencimiento</th>
              <th>Total</th>
              <th>Pagado</th>
              <th>Saldo</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody id="receivables-table-body">
            <tr><td colspan="8" style="text-align:center;padding:30px">Cargando...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  const tbody = document.getElementById('receivables-table-body');
  try {
    const data = await api.getInvoices();
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const invoices = (data.invoices || []).filter(invoice =>
      !['anulada', 'borrador'].includes(invoice.status)
      && Number(invoice.balance_due) > 0
    );
    const outstanding = invoices.reduce(
      (total, invoice) => total + Number(invoice.balance_due || 0),
      0
    );
    const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);

    document.getElementById('receivables-total').textContent =
      Utils.formatCurrency(outstanding);

    if (!invoices.length) {
      tbody.innerHTML = `
        <tr><td colspan="8">
          <div class="dashboard-empty">
            <span class="dashboard-empty-icon">${Utils.icon('check')}</span>
            <strong>Todo al día</strong>
            <span>No hay facturas pendientes de cobro.</span>
          </div>
        </td></tr>
      `;
      return;
    }

    tbody.innerHTML = invoices.map(invoice => `
      <tr>
        <td><span class="receivable-invoice">${escapeHTML(invoice.invoice_number || '-')}</span></td>
        <td><span class="receivable-client">${escapeHTML(invoice.contacts?.name || 'Cliente no disponible')}</span></td>
        <td>${Utils.formatDate(invoice.issue_date)}</td>
        <td>${invoice.due_date ? Utils.formatDate(invoice.due_date) : 'Sin vencimiento'}</td>
        <td>${Utils.formatCurrency(invoice.total)}</td>
        <td>${Utils.formatCurrency(invoice.amount_paid)}</td>
        <td><span class="receivable-balance">${Utils.formatCurrency(invoice.balance_due)}</span></td>
        <td><span class="receivable-status ${invoice.due_date && invoice.due_date < today ? 'overdue' : ''}">${invoice.due_date && invoice.due_date < today ? 'Vencida' : escapeHTML(invoice.payment_status || 'pendiente')}</span></td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error cargando cuentas por cobrar:', err);
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px">No se pudieron cargar las cuentas por cobrar.</td></tr>';
    Utils.showToast('Error cargando cuentas por cobrar', 'error');
  }
},

async loadPurchaseInvoicesView(container) {
  container.innerHTML = `
    <div class="d-flex justify-between align-center mb-3">
      <div>
        <h2>Facturas de Compra</h2>
        <p class="text-muted">Compras a proveedores, separadas de las facturas de venta.</p>
      </div>
      <button class="btn btn-primary" id="btn-new-purchase-invoice">
        ${Utils.icon('package')} Registrar compra
      </button>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Registro de compra</th>
              <th>Fecha</th>
              <th>Proveedor</th>
              <th>Factura del proveedor</th>
              <th>Bodega</th>
              <th>Total</th>
              <th>Productos</th>
            </tr>
          </thead>
          <tbody id="purchase-invoices-table-body">
            <tr><td colspan="7" style="text-align:center;padding:30px">Cargando facturas de compra...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('btn-new-purchase-invoice')
    .addEventListener('click', () => this.showPurchaseModal());

  try {
    const data = await api.getPurchases();
    this.renderPurchasesTable(data.purchases || [], 'purchase-invoices-table-body');
  } catch (err) {
    console.error('Error cargando facturas de compra:', err);
    const tbody = document.getElementById('purchase-invoices-table-body');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--danger)"></td></tr>';
      tbody.querySelector('td').textContent = err.message || 'No se pudieron cargar las facturas de compra.';
    }
    Utils.showToast(err.message || 'Error cargando facturas de compra', 'error');
  }
},

async loadInvoicesView(container) {
  container.innerHTML = `
    <div class="d-flex justify-between align-center mb-3">
      <h2>Facturas</h2>
      <a href="#/pos" class="btn btn-primary">${Utils.icon('cart')} Nueva Venta (POS)</a>
    </div>

    <div class="kpi-grid mb-3" id="invoices-kpis"></div>

    <div class="card mb-3">
      <div class="card-body">
        <div class="d-flex gap-2">
          <input type="text" id="search-invoices" placeholder="Buscar por número, cliente o documento..."
            style="flex:1; padding:10px 16px; border:2px solid var(--border-color); border-radius:var(--radius-sm);">
          <select id="filter-invoice-status" style="padding:10px 16px; border:2px solid var(--border-color); border-radius:var(--radius-sm);">
            <option value="">Todos los estados</option>
            <option value="borrador">Borrador</option>
            <option value="emitida">Emitida</option>
            <option value="pagada">Pagada</option>
            <option value="parcial">Pago Parcial</option>
            <option value="anulada">Anulada</option>
          </select>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>N° Factura</th>
              <th>Cliente</th>
              <th>Fecha</th>
              <th>Total</th>
              <th>Pagado</th>
              <th>Saldo</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody id="invoices-table-body">
            <tr><td colspan="8" style="text-align:center; padding:40px;">Cargando...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  const searchInput = document.getElementById('search-invoices');
  const statusFilter = document.getElementById('filter-invoice-status');

  const loadInvoices = async () => {
    const params = {};
    if (searchInput.value) params.search = searchInput.value;
    if (statusFilter.value) params.status = statusFilter.value;

    try {
      const data = await api.getInvoices(params);
      console.log('🔎 Respuesta completa de facturas:', data);
      console.log('🔎 Lista de facturas:', data.invoices);
      console.log('🔎 Estadísticas:', data.stats);

      this.renderInvoicesKPIs(data.stats);
      this.renderInvoicesTable(data.invoices || []);
    } catch (err) {
      console.error('❌ Error cargando facturas:', err);
      Utils.showToast('Error cargando facturas', 'error');
    }
  };

  searchInput.addEventListener('input', Utils.debounce(loadInvoices, 300));
  statusFilter.addEventListener('change', loadInvoices);

  await loadInvoices();
},

renderInvoicesKPIs(stats) {
  const container = document.getElementById('invoices-kpis');
  if (!container) return;

  container.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Total Facturas</div>
      <div class="kpi-value">${stats.total || 0}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Monto Total</div>
      <div class="kpi-value">${Utils.formatCurrency(stats.total_amount || 0)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Pendiente de Cobro</div>
      <div class="kpi-value text-orange">${Utils.formatCurrency(stats.pending_amount || 0)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Emitidas</div>
      <div class="kpi-value text-purple">${stats.by_status?.emitida || 0}</div>
    </div>
  `;
},

renderInvoicesTable(invoices) {
  const tbody = document.getElementById('invoices-table-body');

  if (invoices.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:40px; color:var(--text-muted);">No se encontraron facturas</td></tr>';
    return;
  }

  const statusClass = {
    'borrador': 'warning', 'emitida': 'info', 'pagada': 'success',
    'parcial': 'warning', 'anulada': 'danger', 'vencida': 'danger'
  };

  tbody.innerHTML = invoices.map(inv => `
    <tr>
      <td><strong>${inv.invoice_number}</strong></td>
      <td>
        <div style="font-weight:600;">${inv.contacts?.name || 'Sin cliente'}</div>
        <div class="text-muted" style="font-size:12px;">${inv.contacts?.document_number || '-'}</div>
      </td>
      <td>${Utils.formatDate(inv.issue_date)}</td>
      <td><strong>${Utils.formatCurrency(inv.total)}</strong></td>
      <td>${Utils.formatCurrency(inv.paid_amount)}</td>
      <td class="${parseFloat(inv.balance) > 0 ? 'text-danger fw-bold' : 'text-success'}">${Utils.formatCurrency(inv.balance)}</td>
      <td><span class="badge-status ${statusClass[inv.status] || 'info'}">${inv.status.toUpperCase()}</span></td>
      <td>
        <div class="d-flex gap-1">
          <button class="btn btn-sm btn-secondary" aria-label="Ver factura" title="Ver factura" onclick="App.viewInvoice('${inv.id}')">${Utils.icon('eye')}</button>
          ${inv.status !== 'anulada' ? `<button class="btn btn-sm btn-danger" aria-label="Anular factura" title="Anular factura" onclick="App.cancelInvoice('${inv.id}', '${inv.invoice_number}')">${Utils.icon('close')}</button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');
},

async viewInvoice(id) {
  try {
    const data = await api.getInvoice(id);
    const inv = data.invoice;
    const items = inv.invoice_items || [];

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'invoice-view-modal';

    overlay.innerHTML = `
      <div class="modal" style="max-width:800px;">
        <div class="modal-header">
          <h3>Factura ${inv.invoice_number}</h3>
          <button class="btn-icon" onclick="document.getElementById('invoice-view-modal').remove()">✕</button>
        </div>
        <div class="modal-body">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:20px;">
            <div>
              <div style="font-size:12px; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px;">Empresa</div>
              <div style="font-weight:700;">${inv.companies?.name || 'AGROSSAM'}</div>
              <div style="font-size:13px;">RUC: ${inv.companies?.ruc || '-'}</div>
              <div style="font-size:13px;">${inv.companies?.address || ''}</div>
            </div>
            <div>
              <div style="font-size:12px; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px;">Cliente</div>
              <div style="font-weight:700;">${inv.contacts?.name || 'Sin cliente asociado'}</div>
              <div style="font-size:13px;">${inv.contacts?.document_type ? inv.contacts.document_type.toUpperCase() : 'Documento'}: ${inv.contacts?.document_number || '-'}</div>
              <div style="font-size:13px;">${inv.contacts?.address || ''}</div>
            </div>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:20px; padding:12px; background:var(--bg-body); border-radius:var(--radius-sm);">
            <div>
              <div style="font-size:11px; color:var(--text-muted);">N° Factura</div>
              <div style="font-weight:700;">${inv.invoice_number}</div>
            </div>
            <div>
              <div style="font-size:11px; color:var(--text-muted);">Fecha Emisión</div>
              <div style="font-weight:700;">${Utils.formatDate(inv.issue_date)}</div>
            </div>
            <div>
              <div style="font-size:11px; color:var(--text-muted);">Estado</div>
              <div><span class="badge-status info">${inv.status.toUpperCase()}</span></div>
            </div>
          </div>

          <table style="width:100%; border-collapse:collapse;">
            <thead>
              <tr style="background:var(--bg-body);">
                <th style="padding:10px; text-align:left;">Producto</th>
                <th style="padding:10px; text-align:right;">Cant.</th>
                <th style="padding:10px; text-align:right;">P. Unit.</th>
                <th style="padding:10px; text-align:right;">IVA</th>
                <th style="padding:10px; text-align:right;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(item => `
                <tr style="border-bottom:1px solid var(--border-light);">
                  <td style="padding:10px;">
                    <div style="font-weight:600;">${item.description || item.products?.name || 'Producto sin nombre'}</div>
                    <div style="font-size:11px; color:var(--text-muted);">${item.products?.sku || ''}</div>
                  </td>
                  <td style="padding:10px; text-align:right;">${item.quantity} ${item.products?.unit || ''}</td>
                  <td style="padding:10px; text-align:right;">${Utils.formatCurrency(item.unit_price)}</td>
                  <td style="padding:10px; text-align:right;">${Utils.formatCurrency(item.tax_amount)}</td>
                  <td style="padding:10px; text-align:right; font-weight:700;">${Utils.formatCurrency(item.total)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div style="margin-top:20px; text-align:right;">
            <div class="d-flex justify-between" style="padding:4px 0;"><span>Subtotal:</span><span>${Utils.formatCurrency(inv.subtotal)}</span></div>
            <div class="d-flex justify-between" style="padding:4px 0;"><span>IVA:</span><span>${Utils.formatCurrency(inv.tax_amount)}</span></div>
            ${inv.discount > 0 ? `<div class="d-flex justify-between" style="padding:4px 0; color:var(--danger);"><span>Descuento:</span><span>-${Utils.formatCurrency(inv.discount)}</span></div>` : ''}
            <div class="d-flex justify-between" style="padding:8px 0; font-size:20px; font-weight:800; color:var(--primary); border-top:2px solid var(--border-color); margin-top:8px;">
              <span>TOTAL:</span><span>${Utils.formatCurrency(inv.total)}</span>
            </div>
            <div class="d-flex justify-between" style="padding:4px 0;"><span>Pagado:</span><span>${Utils.formatCurrency(inv.amount_paid)}</span></div>
            <div class="d-flex justify-between" style="padding:4px 0; font-weight:700;"><span>Saldo:</span><span class="${parseFloat(inv.balance_due) > 0 ? 'text-danger' : 'text-success'}">${Utils.formatCurrency(inv.balance_due)}</span></div>
          </div>

          ${inv.notes ? `<div style="margin-top:16px; padding:12px; background:var(--bg-body); border-radius:var(--radius-sm);"><strong>Notas:</strong> ${inv.notes}</div>` : ''}
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('invoice-view-modal').remove()">Cerrar</button>
          <button class="btn btn-primary" onclick="window.print()">${Utils.icon('printer')} Imprimir</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  } catch (err) {
      console.error('Error al cargar el detalle de la factura:', err);
      Utils.showToast('Error al cargar factura', 'error');
  }
},

async cancelInvoice(id, number) {
  const reason = window.prompt(`Motivo de anulación de la factura ${number}:`);
  if (!reason) return;

  if (!window.confirm(`¿Está seguro de anular la factura ${number}? Esta acción revertirá el stock.`)) return;

  try {
    await api.cancelInvoice(id, reason);
    Utils.showToast('Factura anulada exitosamente');
    this.loadSalesTab('invoices');
  } catch (err) {
    Utils.showToast(err.message, 'error');
  }
},

// ==========================================
// COTIZACIONES (CU-09)
// ==========================================
async loadQuotesView(container) {
  container.innerHTML = `
    <div class="d-flex justify-between align-center mb-3">
      <h2>Cotizaciones</h2>
      <button class="btn btn-primary" id="btn-new-quote">${Utils.icon('file-plus')} Nueva Cotización</button>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>N° Cotización</th>
              <th>Cliente</th>
              <th>Fecha</th>
              <th>Válida hasta</th>
              <th>Total</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody id="quotes-table-body">
            <tr><td colspan="7" style="text-align:center; padding:40px;">Cargando...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('btn-new-quote').addEventListener('click', () => this.showQuoteModal());

  try {
    const data = await api.getQuotes();
    const tbody = document.getElementById('quotes-table-body');

    if (!data.quotes || data.quotes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:40px; color:var(--text-muted);">Sin cotizaciones</td></tr>';
      return;
    }

    const statusClass = {
      'borrador': 'warning', 'enviada': 'info', 'aceptada': 'success',
      'rechazada': 'danger', 'convertida': 'success'
    };

    tbody.innerHTML = data.quotes.map(q => `
      <tr>
        <td><strong>${q.quote_number}</strong></td>
        <td>
          <div style="font-weight:600;">${q.contacts.name}</div>
          <div class="text-muted" style="font-size:12px;">${q.contacts.document_number || '-'}</div>
        </td>
        <td>${Utils.formatDate(q.created_at)}</td>
        <td>${q.valid_until ? Utils.formatDate(q.valid_until) : '-'}</td>
        <td><strong>${Utils.formatCurrency(q.total)}</strong></td>
        <td><span class="badge-status ${statusClass[q.status] || 'info'}">${q.status.toUpperCase()}</span></td>
        <td>
          <div class="d-flex gap-1">
            <button class="btn btn-sm btn-secondary" aria-label="Ver cotización" title="Ver cotización" onclick="App.viewQuote('${q.id}')">${Utils.icon('eye')}</button>
            ${q.status === 'aceptada' || q.status === 'borrador' || q.status === 'enviada' ?
              `<button class="btn btn-sm btn-primary" aria-label="Convertir cotización" title="Convertir cotización" onclick="App.convertQuote('${q.id}')">${Utils.icon('repeat')}</button>` : ''}
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    Utils.showToast('Error cargando cotizaciones', 'error');
  }
},

showQuoteModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'quote-modal';

  overlay.innerHTML = `
    <div class="modal" style="max-width:800px;">
      <div class="modal-header">
        <h3>Nueva Cotización</h3>
        <button class="btn-icon" onclick="document.getElementById('quote-modal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group full-width">
            <label>Cliente</label>
            <select id="quote-client">
              <option value="">Cliente general</option>
            </select>
          </div>
          <div class="form-group">
            <label>Válida hasta</label>
            <input type="date" id="quote-valid" value="${new Date(Date.now() + 15*24*60*60*1000).toISOString().split('T')[0]}">
          </div>
          <div class="form-group full-width">
            <label>Notas</label>
            <textarea id="quote-notes" rows="2" style="width:100%; padding:12px 16px; border:2px solid var(--border-color); border-radius:var(--radius-sm);"></textarea>
          </div>
        </div>

        <div style="margin-top:20px;">
          <div class="d-flex justify-between align-center mb-2">
            <label style="font-weight:700;">Productos</label>
            <button class="btn btn-sm btn-primary" id="btn-add-quote-item"> Agregar Producto</button>
          </div>
          <div id="quote-items-list"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('quote-modal').remove()">Cancelar</button>
        <button class="btn btn-primary" id="btn-save-quote">Crear Cotización</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Cargar clientes y productos
  Promise.all([
    api.getContacts({ type: 'cliente' }),
    api.getProducts()
  ]).then(([clientsData, prodData]) => {
    document.getElementById('quote-client').innerHTML =
      '<option value="">Cliente general</option>' +
      (clientsData.contacts || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');

    this.quoteProductsCache = prodData.products || [];
  });

  this.quoteItems = [];

  document.getElementById('btn-add-quote-item').addEventListener('click', () => {
    const productSelect = document.createElement('select');
    productSelect.style.cssText = 'width:100%; padding:8px; border:2px solid var(--border-color); border-radius:var(--radius-sm); margin-bottom:8px;';
    productSelect.innerHTML = '<option value="">Seleccionar producto</option>' +
      (this.quoteProductsCache || []).map(p => `<option value="${p.id}" data-price="${p.sale_price}" data-tax="${p.tax_rate ?? 15}">${p.name} (${p.sku}) - ${Utils.formatCurrency(p.sale_price)}</option>`).join('');

    productSelect.addEventListener('change', (e) => {
      const option = e.target.selectedOptions[0];
      if (!option.value) return;

      this.quoteItems.push({
        product_id: option.value,
        name: option.text.split(' - ')[0],
        unit_price: parseFloat(option.dataset.price),
        tax_rate: parseFloat(option.dataset.tax),
        quantity: 1
      });

      this.renderQuoteItems();
    });

    const container = document.getElementById('quote-items-list');
    container.appendChild(productSelect);
  });

  document.getElementById('btn-save-quote').addEventListener('click', async () => {
    if (this.quoteItems.length === 0) {
      Utils.showToast('Agrega al menos un producto', 'error');
      return;
    }

    try {
      const btn = document.getElementById('btn-save-quote');
      btn.disabled = true;
      btn.textContent = 'Creando...';

      await api.createQuote({
        contact_id: document.getElementById('quote-client').value || null,
        valid_until: document.getElementById('quote-valid').value,
        notes: document.getElementById('quote-notes').value.trim(),
        items: this.quoteItems
      });

      Utils.showToast('Cotización creada');
      document.getElementById('quote-modal').remove();
      this.loadSalesTab('quotes');
    } catch (err) {
      Utils.showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Crear Cotización';
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
},

renderQuoteItems() {
  const container = document.getElementById('quote-items-list');
  if (!container) return;

  container.innerHTML = this.quoteItems.map((item, idx) => `
    <div style="display:grid; grid-template-columns: 2fr 1fr 1fr auto; gap:8px; align-items:center; padding:8px; background:var(--bg-body); border-radius:var(--radius-sm); margin-bottom:8px;">
      <div style="font-weight:600; font-size:13px;">${item.name}</div>
      <input type="number" value="${item.quantity}" min="1" step="1"
        onchange="App.updateQuoteItem(${idx}, 'quantity', this.value)"
        style="padding:6px; border:1px solid var(--border-color); border-radius:4px; text-align:center;">
      <div style="text-align:right; font-weight:700;">${Utils.formatCurrency(item.quantity * item.unit_price * (1 + item.tax_rate/100))}</div>
      <button class="btn-icon" aria-label="Quitar artículo" title="Quitar artículo" onclick="App.removeQuoteItem(${idx})" style="color:var(--danger);">${Utils.icon('trash')}</button>
    </div>
  `).join('');
},

updateQuoteItem(idx, field, value) {
  this.quoteItems[idx][field] = parseFloat(value);
  this.renderQuoteItems();
},

removeQuoteItem(idx) {
  this.quoteItems.splice(idx, 1);
  this.renderQuoteItems();
},

async convertQuote(id) {
  if (!window.confirm('¿Convertir esta cotización en factura?')) return;
  try {
    await api.convertQuote(id);
    Utils.showToast('Cotización convertida en factura');
    this.loadSalesTab('quotes');
  } catch (err) {
    Utils.showToast(err.message, 'error');
  }
},

async viewQuote(id) {
  try {
    const data = await api.getQuote(id);
    const q = data.quote;
    const items = q.quote_items || [];

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'quote-view-modal';

    overlay.innerHTML = `
      <div class="modal" style="max-width:700px;">
        <div class="modal-header">
          <h3>Cotización ${q.quote_number}</h3>
          <button class="btn-icon" onclick="document.getElementById('quote-view-modal').remove()">✕</button>
        </div>
        <div class="modal-body">
          <div style="margin-bottom:16px;">
            <div style="font-size:12px; color:var(--text-muted);">Cliente</div>
            <div style="font-weight:700;">${q.contacts.name}</div>
            <div style="font-size:13px;">${q.contacts.document_type?.toUpperCase()}: ${q.contacts.document_number || '-'}</div>
          </div>
          <table style="width:100%;">
            <thead>
              <tr style="background:var(--bg-body);">
                <th style="padding:8px; text-align:left;">Producto</th>
                <th style="padding:8px; text-align:right;">Cant.</th>
                <th style="padding:8px; text-align:right;">P. Unit.</th>
                <th style="padding:8px; text-align:right;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(item => `
                <tr style="border-bottom:1px solid var(--border-light);">
                  <td style="padding:8px;">${item.description || item.products?.name}</td>
                  <td style="padding:8px; text-align:right;">${item.quantity}</td>
                  <td style="padding:8px; text-align:right;">${Utils.formatCurrency(item.unit_price)}</td>
                  <td style="padding:8px; text-align:right; font-weight:700;">${Utils.formatCurrency(item.total)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div style="text-align:right; margin-top:16px; font-size:18px; font-weight:800; color:var(--primary);">
            Total: ${Utils.formatCurrency(q.total)}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('quote-view-modal').remove()">Cerrar</button>
          ${q.status !== 'convertida' ? `<button class="btn btn-primary" onclick="App.convertQuote('${q.id}'); document.getElementById('quote-view-modal').remove();">${Utils.icon('repeat')} Convertir en Factura</button>` : ''}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  } catch (err) {
    Utils.showToast('Error al cargar cotización', 'error');
  }
},

// ==========================================
// NOTAS DE CRÉDITO (CU-10)
// ==========================================
async loadCreditNotesView(container) {
  container.innerHTML = `
    <div class="d-flex justify-between align-center mb-3">
      <h2>Notas de Crédito</h2>
      <button class="btn btn-primary" id="btn-new-cn">${Utils.icon('file-plus')} Nueva Nota de Crédito</button>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>N° Nota</th>
              <th>Factura</th>
              <th>Cliente</th>
              <th>Motivo</th>
              <th>Total</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody id="cn-table-body">
            <tr><td colspan="6" style="text-align:center; padding:40px;">Cargando...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('btn-new-cn').addEventListener('click', () => this.showCreditNoteModal());

  try {
    const data = await api.getCreditNotes();
    const tbody = document.getElementById('cn-table-body');

    if (!data.credit_notes || data.credit_notes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:40px; color:var(--text-muted);">Sin notas de crédito</td></tr>';
      return;
    }

    tbody.innerHTML = data.credit_notes.map(cn => `
      <tr>
        <td><strong>${cn.credit_note_number}</strong></td>
        <td>${cn.invoices?.invoice_number || '-'}</td>
        <td>${cn.invoices?.contacts?.name || '-'}</td>
        <td>${cn.reason || '-'}</td>
        <td><strong>${Utils.formatCurrency(cn.total)}</strong></td>
        <td>${Utils.formatDate(cn.created_at)}</td>
      </tr>
    `).join('');
  } catch (err) {
    Utils.showToast('Error cargando notas de crédito', 'error');
  }
},

showCreditNoteModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'cn-modal';

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>Nueva Nota de Crédito</h3>
        <button class="btn-icon" onclick="document.getElementById('cn-modal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Factura *</label>
          <select id="cn-invoice">
            <option value="">Seleccionar factura</option>
          </select>
        </div>
        <div class="form-group">
          <label>Motivo *</label>
          <textarea id="cn-reason" rows="3" style="width:100%; padding:12px 16px; border:2px solid var(--border-color); border-radius:var(--radius-sm);"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('cn-modal').remove()">Cancelar</button>
        <button class="btn btn-primary" id="btn-save-cn">Crear</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  api.getInvoices({ status: 'emitida' }).then(data => {
    document.getElementById('cn-invoice').innerHTML =
      '<option value="">Seleccionar factura</option>' +
      (data.invoices || []).map(inv => `<option value="${inv.id}">${inv.invoice_number} - ${inv.contacts.name} (${Utils.formatCurrency(inv.total)})</option>`).join('');
  });

  document.getElementById('btn-save-cn').addEventListener('click', async () => {
    const invoice_id = document.getElementById('cn-invoice').value;
    const reason = document.getElementById('cn-reason').value.trim();

    if (!invoice_id || !reason) {
      Utils.showToast('Factura y motivo son requeridos', 'error');
      return;
    }

    try {
      const btn = document.getElementById('btn-save-cn');
      btn.disabled = true;
      btn.textContent = 'Creando...';

      // Obtener items de la factura para crear la nota
      const invData = await api.getInvoice(invoice_id);
      const items = (invData.invoice.invoice_items || []).map(i => ({
        product_id: i.product_id,
        quantity: i.quantity,
        unit_price: i.unit_price,
        tax_rate: i.tax_rate
      }));

      await api.createCreditNote({ invoice_id, reason, items });
      Utils.showToast('Nota de crédito creada');
      document.getElementById('cn-modal').remove();
      this.loadSalesTab('credit-notes');
    } catch (err) {
      Utils.showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Crear';
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
},

// ==========================================
// NOTAS DE ENTREGA (CU-11)
// ==========================================
async loadDeliveryNotesView(container) {
  container.innerHTML = `
    <div class="d-flex justify-between align-center mb-3">
      <h2>Notas de Entrega</h2>
      <button class="btn btn-primary" id="btn-new-dn">${Utils.icon('delivery')} Nueva Nota de Entrega</button>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>N° Guía</th>
              <th>Factura</th>
              <th>Cliente</th>
              <th>Fecha Entrega</th>
              <th>Notas</th>
              <th>Fecha Creación</th>
            </tr>
          </thead>
          <tbody id="dn-table-body">
            <tr><td colspan="6" style="text-align:center; padding:40px;">Cargando...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('btn-new-dn').addEventListener('click', () => this.showDeliveryNoteModal());

  try {
    const data = await api.getDeliveryNotes();
    const tbody = document.getElementById('dn-table-body');

    if (!data.delivery_notes || data.delivery_notes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:40px; color:var(--text-muted);">Sin notas de entrega</td></tr>';
      return;
    }

    tbody.innerHTML = data.delivery_notes.map(dn => `
      <tr>
        <td><strong>${dn.delivery_number}</strong></td>
        <td>${dn.invoices?.invoice_number || '-'}</td>
        <td>${dn.contacts?.name || '-'}</td>
        <td>${Utils.formatDate(dn.delivery_date)}</td>
        <td>${dn.notes || '-'}</td>
        <td>${Utils.formatDate(dn.created_at)}</td>
      </tr>
    `).join('');
  } catch (err) {
    Utils.showToast('Error cargando notas de entrega', 'error');
  }
},

showDeliveryNoteModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'dn-modal';

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>Nueva Nota de Entrega</h3>
        <button class="btn-icon" onclick="document.getElementById('dn-modal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group full-width">
            <label>Factura (opcional)</label>
            <select id="dn-invoice">
              <option value="">Sin factura asociada</option>
            </select>
          </div>
          <div class="form-group full-width">
            <label>Cliente</label>
            <select id="dn-client">
              <option value="">Seleccionar cliente</option>
            </select>
          </div>
          <div class="form-group">
            <label>Fecha de Entrega</label>
            <input type="date" id="dn-date" value="${new Date().toISOString().split('T')[0]}">
          </div>
          <div class="form-group full-width">
            <label>Notas</label>
            <textarea id="dn-notes" rows="2" style="width:100%; padding:12px 16px; border:2px solid var(--border-color); border-radius:var(--radius-sm);"></textarea>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('dn-modal').remove()">Cancelar</button>
        <button class="btn btn-primary" id="btn-save-dn">Crear</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  Promise.all([
    api.getInvoices(),
    api.getContacts({ type: 'cliente' })
  ]).then(([invData, clientData]) => {
    document.getElementById('dn-invoice').innerHTML =
      '<option value="">Sin factura asociada</option>' +
      (invData.invoices || []).map(inv => `<option value="${inv.id}">${inv.invoice_number}</option>`).join('');

    document.getElementById('dn-client').innerHTML =
      '<option value="">Seleccionar cliente</option>' +
      (clientData.contacts || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  });

  document.getElementById('btn-save-dn').addEventListener('click', async () => {
    try {
      const btn = document.getElementById('btn-save-dn');
      btn.disabled = true;
      btn.textContent = 'Creando...';

      await api.createDeliveryNote({
        invoice_id: document.getElementById('dn-invoice').value || null,
        contact_id: document.getElementById('dn-client').value || null,
        delivery_date: document.getElementById('dn-date').value,
        notes: document.getElementById('dn-notes').value.trim()
      });

      Utils.showToast('Nota de entrega creada');
      document.getElementById('dn-modal').remove();
      this.loadSalesTab('delivery-notes');
    } catch (err) {
      Utils.showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Crear';
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
},

// ==========================================
// FACTURAS RECURRENTES (CU-12)
// ==========================================
async loadRecurringView(container) {
  container.innerHTML = `
    <div class="d-flex justify-between align-center mb-3">
      <h2>Facturas Recurrentes</h2>
      <button class="btn btn-primary" id="btn-new-recurring">${Utils.icon('repeat')} Nueva Factura Recurrente</button>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Frecuencia</th>
              <th>Próxima Emisión</th>
              <th>Fecha Fin</th>
              <th>Total</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody id="recurring-table-body">
            <tr><td colspan="6" style="text-align:center; padding:40px;">Cargando...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('btn-new-recurring').addEventListener('click', () => this.showRecurringModal());

  try {
    const data = await api.getRecurringInvoices();
    const tbody = document.getElementById('recurring-table-body');

    if (!data.recurring || data.recurring.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:40px; color:var(--text-muted);">Sin facturas recurrentes</td></tr>';
      return;
    }

    const freqLabels = {
      'semanal': 'Semanal', 'quincenal': 'Quincenal', 'mensual': 'Mensual',
      'trimestral': 'Trimestral', 'anual': 'Anual'
    };

    tbody.innerHTML = data.recurring.map(r => `
      <tr>
        <td><strong>${r.contacts.name}</strong></td>
        <td><span class="badge-status info">${freqLabels[r.frequency] || r.frequency}</span></td>
        <td>${Utils.formatDate(r.next_issue_date)}</td>
        <td>${r.end_date ? Utils.formatDate(r.end_date) : 'Indefinido'}</td>
        <td><strong>${Utils.formatCurrency(r.total)}</strong></td>
        <td><span class="badge-status ${r.is_active ? 'success' : 'danger'}">${r.is_active ? 'Activa' : 'Inactiva'}</span></td>
      </tr>
    `).join('');
  } catch (err) {
    Utils.showToast('Error cargando facturas recurrentes', 'error');
  }
},

showRecurringModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'recurring-modal';

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>Nueva Factura Recurrente</h3>
        <button class="btn-icon" onclick="document.getElementById('recurring-modal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group full-width">
            <label>Cliente *</label>
            <select id="rec-client">
              <option value="">Seleccionar cliente</option>
            </select>
          </div>
          <div class="form-group">
            <label>Frecuencia *</label>
            <select id="rec-frequency">
              <option value="semanal">Semanal</option>
              <option value="quincenal">Quincenal</option>
              <option value="mensual" selected>Mensual</option>
              <option value="trimestral">Trimestral</option>
              <option value="anual">Anual</option>
            </select>
          </div>
          <div class="form-group">
            <label>Próxima Emisión *</label>
            <input type="date" id="rec-next" value="${new Date().toISOString().split('T')[0]}">
          </div>
          <div class="form-group full-width">
            <label>Fecha Fin (opcional)</label>
            <input type="date" id="rec-end">
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('recurring-modal').remove()">Cancelar</button>
        <button class="btn btn-primary" id="btn-save-rec">Crear</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  api.getContacts({ type: 'cliente' }).then(data => {
    document.getElementById('rec-client').innerHTML =
      '<option value="">Seleccionar cliente</option>' +
      (data.contacts || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  });

  document.getElementById('btn-save-rec').addEventListener('click', async () => {
    Utils.showToast('Funcionalidad en desarrollo', 'info');
    document.getElementById('recurring-modal').remove();
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
},

async loadPurchases(container) {
  container.innerHTML = `
    <div class="page-header d-flex justify-between align-center">
      <div>
        <h1>Compras a Proveedores</h1>
        <p class="text-muted">Registra facturas de proveedor y actualiza las existencias de la bodega.</p>
      </div>
      <button class="btn btn-primary" id="btn-new-purchase">
        ${Utils.icon('package')} Registrar compra
      </button>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Registro</th>
              <th>Fecha</th>
              <th>Proveedor</th>
              <th>Factura del proveedor</th>
              <th>Bodega</th>
              <th>Total</th>
              <th>Productos</th>
            </tr>
          </thead>
          <tbody id="purchases-table-body">
            <tr><td colspan="7" style="text-align:center;padding:30px">Cargando compras...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('btn-new-purchase')
    .addEventListener('click', () => this.showPurchaseModal());
  await this.refreshPurchases();
},

async refreshPurchases() {
  try {
    const data = await api.getPurchases();
    this.renderPurchasesTable(data.purchases || []);
    this.renderPurchasesTable(data.purchases || [], 'purchase-invoices-table-body');
  } catch (err) {
    console.error('Error cargando compras:', err);
    ['purchases-table-body', 'purchase-invoices-table-body'].forEach(id => {
      const tbody = document.getElementById(id);
      if (!tbody) return;
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--danger)"></td></tr>';
      tbody.querySelector('td').textContent = err.message || 'No se pudieron cargar las compras.';
    });
    Utils.showToast(err.message || 'Error cargando compras', 'error');
  }
},

renderPurchasesTable(purchases, tbodyId = 'purchases-table-body') {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);

  if (!purchases.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px">Todavía no hay compras registradas.</td></tr>';
    return;
  }

  tbody.innerHTML = purchases.map(purchase => `
    <tr>
      <td>${escapeHTML(purchase.purchase_number)}</td>
      <td>${escapeHTML(Utils.formatDate(purchase.purchase_date))}</td>
      <td>${escapeHTML(purchase.contacts?.name || 'Proveedor')}</td>
      <td>${escapeHTML(purchase.supplier_invoice_number || '—')}</td>
      <td>${escapeHTML(purchase.warehouses?.name || '—')}</td>
      <td>${escapeHTML(Utils.formatCurrency(purchase.total))}</td>
      <td>${escapeHTML(purchase.purchase_items?.length || 0)}</td>
    </tr>
  `).join('');
},

async showPurchaseModal() {
  let suppliers;
  let products;
  let warehouses;
  const branchId = this.user?.branch?.id || this.user?.branch_id;

  if (!branchId) {
    Utils.showToast('Tu usuario no tiene una sucursal asignada. Contacta al administrador.', 'error');
    return;
  }

  try {
    const [contactsData, productsData, warehousesData] = await Promise.all([
      api.getContacts({ type: 'proveedor', is_active: 'true' }),
      api.getProducts({ is_active: 'true' }),
      api.getWarehouses({ branch_id: branchId })
    ]);
    suppliers = contactsData.contacts || [];
    products = (productsData.products || []).filter(product => product.is_active !== false);
    warehouses = (warehousesData.warehouses || []).filter(warehouse =>
      warehouse.is_active !== false &&
      warehouse.branch_id === branchId
    );
  } catch (err) {
    console.error('Error preparando el formulario de compra:', err);
    Utils.showToast(err.message || 'No se pudieron cargar proveedores, productos o bodegas', 'error');
    return;
  }

  if (!suppliers.length || !products.length || !warehouses.length) {
    Utils.showToast(
      !suppliers.length
        ? 'Registra primero un proveedor activo.'
        : !products.length
          ? 'No hay productos activos en esta empresa.'
          : 'No hay bodegas activas asignadas a tu sucursal.',
      'error'
    );
    return;
  }

  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'purchase-modal';
  overlay.innerHTML = `
    <div class="modal" style="max-width:900px;width:95%;">
      <div class="modal-header">
        <h3>${Utils.icon('package')} Registrar compra</h3>
        <button class="btn-icon" type="button" data-close-purchase aria-label="Cerrar">${Utils.icon('close')}</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group">
            <label for="purchase-supplier">Proveedor</label>
            <select id="purchase-supplier" required>
              <option value="">Seleccionar proveedor</option>
              ${suppliers.map(supplier => `<option value="${escapeHTML(supplier.id)}">${escapeHTML(supplier.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label for="purchase-warehouse">Bodega de ingreso</label>
            <select id="purchase-warehouse" required>
              ${warehouses.map(warehouse => `<option value="${escapeHTML(warehouse.id)}">${escapeHTML(warehouse.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label for="purchase-invoice">Número de factura del proveedor</label>
            <input type="text" id="purchase-invoice" maxlength="100" placeholder="Ej. FC-001-000123">
          </div>
          <div class="form-group">
            <label for="purchase-date">Fecha de compra</label>
            <input type="date" id="purchase-date" value="${today}" required>
          </div>
          <div class="form-group full-width">
            <label for="purchase-notes">Notas</label>
            <input type="text" id="purchase-notes" maxlength="500" placeholder="Notas opcionales">
          </div>
        </div>
        <div class="d-flex justify-between align-center" style="margin:20px 0 12px;">
          <strong>Productos recibidos</strong>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-add-purchase-item">
            ${Utils.icon('plus')} Agregar producto
          </button>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr><th>Producto</th><th>Cantidad</th><th>Costo unitario</th><th>IVA %</th><th>Importe</th><th></th></tr>
            </thead>
            <tbody id="purchase-items-body"></tbody>
          </table>
        </div>
        <div style="text-align:right;margin-top:16px;font-size:18px;font-weight:700;">
          Total de compra: <span id="purchase-total">${Utils.formatCurrency(0)}</span>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" data-close-purchase>Cancelar</button>
        <button class="btn btn-primary" type="button" id="btn-save-purchase">${Utils.icon('check')} Guardar compra</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const itemsBody = overlay.querySelector('#purchase-items-body');
  const productOptions = products.map(product => `
    <option value="${escapeHTML(product.id)}" data-cost="${escapeHTML(product.cost_price)}" data-tax="${escapeHTML(product.tax_rate ?? 15)}">
      ${escapeHTML(product.sku || 'Sin SKU')} — ${escapeHTML(product.name)}
    </option>
  `).join('');

  const addItemRow = () => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><select data-purchase-product required><option value="">Seleccionar producto</option>${productOptions}</select></td>
      <td><input data-purchase-quantity type="number" min="0.001" step="0.001" value="1" style="width:90px" required></td>
      <td><input data-purchase-cost type="number" min="0" step="0.0001" value="0" style="width:120px" required></td>
      <td><input data-purchase-tax type="number" min="0" max="100" step="0.01" value="15" style="width:75px" required></td>
      <td data-purchase-line-total>${Utils.formatCurrency(0)}</td>
      <td><button type="button" class="btn-icon" data-remove-purchase-item aria-label="Quitar producto">${Utils.icon('trash')}</button></td>
    `;
    itemsBody.appendChild(row);
    updateTotal();
  };

  const updateTotal = () => {
    let total = 0;
    itemsBody.querySelectorAll('tr').forEach(row => {
      const quantity = Number(row.querySelector('[data-purchase-quantity]').value) || 0;
      const cost = Number(row.querySelector('[data-purchase-cost]').value) || 0;
      const taxRate = Number(row.querySelector('[data-purchase-tax]').value) || 0;
      const lineSubtotal = quantity * cost;
      const lineTax = Math.round(lineSubtotal * taxRate) / 100;
      const lineTotal = lineSubtotal + lineTax;
      total += lineTotal;
      row.querySelector('[data-purchase-line-total]').textContent = Utils.formatCurrency(lineTotal);
    });
    overlay.querySelector('#purchase-total').textContent = Utils.formatCurrency(total);
  };

  addItemRow();
  overlay.querySelector('#btn-add-purchase-item').addEventListener('click', addItemRow);
  itemsBody.addEventListener('input', updateTotal);
  itemsBody.addEventListener('change', event => {
    if (event.target.matches('[data-purchase-product]')) {
      const option = event.target.selectedOptions[0];
      const row = event.target.closest('tr');
      row.querySelector('[data-purchase-cost]').value = option.dataset.cost || '0';
      row.querySelector('[data-purchase-tax]').value = option.dataset.tax || '15';
      updateTotal();
    }
  });
  itemsBody.addEventListener('click', event => {
    if (!event.target.closest('[data-remove-purchase-item]')) return;
    event.target.closest('tr').remove();
    updateTotal();
  });

  overlay.querySelectorAll('[data-close-purchase]').forEach(button =>
    button.addEventListener('click', () => overlay.remove())
  );
  overlay.addEventListener('click', event => {
    if (event.target === overlay) overlay.remove();
  });

  overlay.querySelector('#btn-save-purchase').addEventListener('click', async event => {
    const supplierId = overlay.querySelector('#purchase-supplier').value;
    const warehouseId = overlay.querySelector('#purchase-warehouse').value;
    const rows = [...itemsBody.querySelectorAll('tr')];
    const items = rows.map(row => ({
      product_id: row.querySelector('[data-purchase-product]').value,
      quantity: Number(row.querySelector('[data-purchase-quantity]').value),
      unit_cost: Number(row.querySelector('[data-purchase-cost]').value),
      tax_rate: Number(row.querySelector('[data-purchase-tax]').value)
    }));

    if (!supplierId || !warehouseId || !rows.length || items.some(item =>
      !item.product_id || !Number.isFinite(item.quantity) || item.quantity <= 0 ||
      !Number.isFinite(item.unit_cost) || item.unit_cost < 0 ||
      !Number.isFinite(item.tax_rate) || item.tax_rate < 0 || item.tax_rate > 100
    )) {
      Utils.showToast('Completa el proveedor, la bodega y los datos de cada producto.', 'error');
      return;
    }

    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Guardando compra...';
    try {
      await api.createPurchase({
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        supplier_invoice_number: overlay.querySelector('#purchase-invoice').value.trim(),
        purchase_date: overlay.querySelector('#purchase-date').value,
        notes: overlay.querySelector('#purchase-notes').value.trim(),
        items
      });
      overlay.remove();
      Utils.showToast('Compra registrada y existencias actualizadas');
      await this.refreshPurchases();
    } catch (err) {
      console.error('Error guardando compra:', err);
      Utils.showToast(err.message || 'No se pudo registrar la compra', 'error');
      button.disabled = false;
      button.innerHTML = `${Utils.icon('check')} Guardar compra`;
    }
  });
},

async loadPayments(container) {
  container.innerHTML = `
    <div class="page-header d-flex justify-between align-center">
      <div>
        <h1>Pagos y Cobros</h1>
        <p class="text-muted">
          Registro de pagos y control de saldos de facturas.
        </p>
      </div>
      <button class="btn btn-primary" id="btn-new-payment">
        ${Utils.icon('wallet')} Registrar pago
      </button>
    </div>

    <div class="card mb-3">
      <div class="card-body d-flex gap-2">
        <input
          type="text"
          id="search-payments"
          placeholder="Buscar por factura o referencia..."
          style="flex:1; padding:10px;"
        >
        <input type="date" id="filter-date-from" style="padding:10px;">
        <input type="date" id="filter-date-to" style="padding:10px;">
      </div>
    </div>

    <div class="card">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Factura</th>
              <th>Método</th>
              <th>Referencia</th>
              <th>Monto</th>
              <th>Estado / Acciones</th>
            </tr>
          </thead>
          <tbody id="payments-table-body">
            <tr>
              <td colspan="7" style="text-align:center;padding:30px">
                Cargando pagos...
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('btn-new-payment')
    .addEventListener('click', () => {
      Utils.showToast('El formulario de registro de pagos aún no está disponible.', 'info');
    });

  const search = document.getElementById('search-payments');
  const from = document.getElementById('filter-date-from');
  const to = document.getElementById('filter-date-to');

  const refresh = async () => {
    try {
      const params = {};
      if (from.value) params.from_date = from.value;
      if (to.value) params.to_date = to.value;

      const data = await api.getPayments(params);
      this.renderPaymentsTable(data.payments || [], search.value);
    } catch (err) {
      console.error('Error cargando pagos:', err);
      Utils.showToast('Error cargando pagos', 'error');
    }
  };

  search.addEventListener('input', () => refresh());
  from.addEventListener('change', refresh);
  to.addEventListener('change', refresh);

  await refresh();
},

renderPaymentsTable(payments, searchTerm = '') {
  const tbody = document.getElementById('payments-table-body');
  if (!tbody) return;

  const term = String(searchTerm).trim().toLowerCase();

  const filtered = payments.filter(payment => {
    const text = [
      payment.contacts?.name,
      payment.contacts?.document_number,
      payment.invoices?.invoice_number,
      payment.reference,
      payment.payment_method,
      payment.status
    ].join(' ').toLowerCase();

    return text.includes(term);
  });

  if (!filtered.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;padding:30px">
          No se encontraron pagos.
        </td>
      </tr>
    `;
    return;
  }

  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);

  tbody.innerHTML = filtered.map(payment => {
    const cancelled = payment.status === 'anulado';

    return `
      <tr>
        <td>
          ${escapeHTML(Utils.formatDate(payment.payment_date))}
        </td>
        <td>${escapeHTML(payment.contacts?.name || 'Cliente no disponible')}</td>
        <td>${escapeHTML(payment.invoices?.invoice_number || 'Sin factura')}</td>
        <td>${escapeHTML(payment.payment_method || '—')}</td>
        <td>${escapeHTML(payment.reference || '—')}</td>
        <td>${escapeHTML(Utils.formatCurrency(payment.amount))}</td>
        <td>
          ${cancelled ? 'Anulado' : 'Activo'}
          ${cancelled ? '—' : `
            <button
              class="btn btn-sm btn-danger"
              data-cancel-payment="${escapeHTML(payment.id)}"
              data-payment-amount="${escapeHTML(payment.amount)}">
              Anular
            </button>
          `}
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-cancel-payment]').forEach(button => {
    button.addEventListener('click', () => {
      this.cancelPayment(
        button.dataset.cancelPayment,
        button.dataset.paymentAmount
      );
    });
  });
},

async cancelPayment(id, amount) {
  if (!window.confirm(
    `¿Deseas anular este pago de ${Utils.formatCurrency(amount)}? Se revertirá el saldo de la factura.`
  )) return;

  try {
    await api.cancelPayment(id);
    Utils.showToast('Pago anulado correctamente');
    await this.loadPayments(document.getElementById('page-content'));
  } catch (err) {
    console.error('Error anulando pago:', err);
    Utils.showToast(err.message || 'No se pudo anular el pago', 'error');
  }
},
}


document.addEventListener('DOMContentLoaded', () => App.init());