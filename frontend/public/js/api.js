const API_BASE = '/api';

class ApiClient {
  constructor() {
    this.token = localStorage.getItem('agrossam_token');
  }

  setToken(token) {
    this.token = token;
    localStorage.setItem('agrossam_token', token);
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('agrossam_token');
    localStorage.removeItem('agrossam_user');
    localStorage.removeItem('agrossam_permissions');
  }

  getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    return headers;
  }

  async request(method, endpoint, data = null) {
    try {
      const options = { method, headers: this.getHeaders() };
      if (data) options.body = JSON.stringify(data);

      const response = await fetch(`${API_BASE}${endpoint}`, options);

      if (response.status === 401) {
        this.clearToken();
        window.location.hash = '#/login';
        throw new Error('Sesión expirada');
      }

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Error en la petición');
      return result;
    } catch (err) {
      console.error(`API ${method} ${endpoint}:`, err);
      throw err;
    }
  }

  get(endpoint) {
  return this.request('GET', endpoint);
}

post(endpoint, data) {
  return this.request('POST', endpoint, data);
}

put(endpoint, data) {
  return this.request('PUT', endpoint, data);
}

patch(endpoint, data) {
  return this.request('PATCH', endpoint, data);
}

delete(endpoint) {
  return this.request('DELETE', endpoint);
}

  // ==========================================
  // AUTH
  // ==========================================
  login(email, password) { return this.post('/auth/login', { email, password }); }
  logout() { return this.post('/auth/logout'); }
  getMe() { return this.get('/auth/me'); }

  // ==========================================
  // USERS
  // ==========================================
  getUsers(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/users${qs ? '?' + qs : ''}`);
  }
  getUser(id) { return this.get(`/users/${id}`); }
  createUser(data) { return this.post('/users', data); }
  updateUser(id, data) { return this.put(`/users/${id}`, data); }
  deleteUser(id) { return this.delete(`/users/${id}`); }
  changePassword(id, data) { return this.put(`/users/${id}/password`, data); }

  // ==========================================
  // BRANCHES
  // ==========================================
  getBranches(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/branches${qs ? '?' + qs : ''}`);
  }
  getBranch(id) { return this.get(`/branches/${id}`); }
  createBranch(data) { return this.post('/branches', data); }
  updateBranch(id, data) { return this.put(`/branches/${id}`, data); }
  deleteBranch(id) { return this.delete(`/branches/${id}`); }

  // ==========================================
  // PRODUCTS
  // ==========================================
  getProducts(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/products${qs ? '?' + qs : ''}`);
  }
  getProduct(id) { return this.get(`/products/${id}`); }
  createProduct(data) { return this.post('/products', data); }
  updateProduct(id, data) { return this.put(`/products/${id}`, data); }
  deleteProduct(id) { return this.delete(`/products/${id}`); }
  getCategories() { return this.get('/products/categories'); }
  createCategory(data) { return this.post('/products/categories', data); }

  // PURCHASES
  getPurchases(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/purchases${qs ? '?' + qs : ''}`);
  }
  createPurchase(data) { return this.post('/purchases', data); }

  // ==========================================
  // INVENTORY
  // ==========================================
  getWarehouses(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/inventory/warehouses${qs ? '?' + qs : ''}`);
  }
  createWarehouse(data) { return this.post('/inventory/warehouses', data); }
  getStock(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/inventory/stock${qs ? '?' + qs : ''}`);
  }
  getMovements(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/inventory/movements${qs ? '?' + qs : ''}`);
  }
  createAdjustment(data) { return this.post('/inventory/adjustments', data); }
  getBatches(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/inventory/batches${qs ? '?' + qs : ''}`);
  }
  createBatch(data) { return this.post('/inventory/batches', data); }

  // ==========================================
  // CONTACTS
  // ==========================================
  getContacts(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/contacts${qs ? '?' + qs : ''}`);
  }
  getContact(id) { return this.get(`/contacts/${id}`); }
  createContact(data) { return this.post('/contacts', data); }
  updateContact(id, data) { return this.put(`/contacts/${id}`, data); }
  deleteContact(id) { return this.delete(`/contacts/${id}`); }
  getContactStats() { return this.get('/contacts/stats/summary'); }

  // ==========================================
  // SALES / FACTURACIÓN (NUEVOS)
  // ==========================================
  getInvoices(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/sales/invoices${qs ? '?' + qs : ''}`);
  }
  getSalesDashboard() { return this.get('/sales/dashboard'); }
  getSalesReport(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/sales/reports${qs ? '?' + qs : ''}`);
  }
  getInvoice(id) { return this.get(`/sales/invoices/${id}`); }
  createInvoice(data) { return this.post('/sales/invoices', data); }
  cancelInvoice(id, reason) {
  return this.patch(`/sales/invoices/${id}/status`, {
    status: 'anulada',
    reason,
  });
  
}
payInvoice(id, amount) {
  return this.post(`/sales/invoices/${id}/payments`, {
    amount,
  });
}

  getQuotes(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/sales/quotes${qs ? '?' + qs : ''}`);
  }
  getQuote(id) { return this.get(`/sales/quotes/${id}`); }
  createQuote(data) { return this.post('/sales/quotes', data); }
  convertQuote(id) { return this.post(`/sales/quotes/${id}/convert`); }

  getCreditNotes() { return this.get('/sales/credit-notes'); }
  createCreditNote(data) { return this.post('/sales/credit-notes', data); }

  getDeliveryNotes() { return this.get('/sales/delivery-notes'); }
  createDeliveryNote(data) { return this.post('/sales/delivery-notes', data); }

  getRecurringInvoices() { return this.get('/sales/recurring'); }
  createRecurringInvoice(data) { return this.post('/sales/recurring', data); }

  // Payments
  getPayments(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/payments${qs ? '?' + qs : ''}`);
  }

  createPayment(data) {
    return this.post('/payments', data);
  }

  cancelPayment(id) {
    return this.post(`/payments/${id}/cancel`);
  }
}

const api = new ApiClient();