const Utils = {
  icon(name, className = '') {
    return `<svg class="ui-icon ${className}" aria-hidden="true" focusable="false"><use href="#icon-${name}"></use></svg>`;
  },
  formatCurrency(amount) {
    return new Intl.NumberFormat('es-NI', {
      style: 'currency',
      currency: 'NIO',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(parseFloat(amount || 0));
  },
  formatNumber(num) {
    return parseInt(num || 0).toLocaleString('es-NI');
  },
  formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('es-NI', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  },
  getCurrentDateFormatted() {
    return new Date().toLocaleDateString('es-NI', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
  },
  capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  },
  showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    const colors = { success: '#2d6a4f', error: '#e63946', info: '#457b9d' };
    toast.style.cssText = `
      position: fixed; top: 20px; right: 20px;
      padding: 14px 24px; border-radius: 10px;
      color: white; font-weight: 600; font-size: 14px;
      z-index: 10000; animation: slideIn 0.3s ease;
      background: ${colors[type] || colors.success};
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },
  getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  },
  getRoleLabel(role) {
    const labels = {
      'administrador': 'Administrador',
      'admin_sucursal': 'Admin. Sucursal',
      'ventas': 'Ventas',
      'inventario': 'Inventario',
      'contabilidad': 'Contabilidad'
    };
    return labels[role] || role;
  },
  debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  }
};