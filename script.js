// =========================================================
  // Formspree — real email delivery for the order form.
  // 1) Go to https://formspree.io and create a free form.
  // 2) Copy the endpoint it gives you (looks like
  //    https://formspree.io/f/abcdwxyz) and paste it below.
  // Until you do, orders still save inside the site + admin
  // panel, but no email will be sent.
  // =========================================================
  const FORMSPREE_ENDPOINT = 'https://formspree.io/f/xeaojekz';
  // Cloudflare Worker used only for secure admin authentication.
  const ADMIN_API = 'https://sosbanoo.amirali-davoudi-1392.workers.dev';

  // ---------------- Data ----------------
  const DEFAULT_PRODUCTS = [
    {id:'mango',    name:'سس انبه',      desc:'ترش‌وشیرین با رایحه‌ی انبه‌های رسیده، مناسب کباب و مرغ.', price:290000, color:'#F2994A'},
    {id:'ketchup',  name:'سس کچاپ',      desc:'گوجه‌ی رسیده و طعمی آشنا، همراه همیشگی سیب‌زمینی و پیتزا.', price:290000, color:'#C1391D'},
    {id:'pizza',    name:'سس پیتزا',     desc:'پایه‌ی غلیظ گوجه با ادویه‌ی مدیترانه‌ای، برای پیتزای خانگی.', price:290000, color:'#8C2F1B'},
    {id:'sandwich', name:'سس ساندویچ',   desc:'کِرمی و ملایم، طعم‌دهنده‌ی هر ساندویچ روزمره.', price:290000, color:'#D98E04'},
    {id:'garlic',   name:'سس سیر',       desc:'تند و معطر، برای عاشقان طعم سیر تازه.', price:290000, color:'#EDE6D6'},
    {id:'pesto',    name:'سس پستو',      desc:'ریحان تازه، روغن زیتون و مغزیجات، اصیل و خوش‌عطر.', price:290000, color:'#5B6F3A'},
    {id:'salad',    name:'سس سالاد',     desc:'سبک و تازه، مکمل بی‌نقص هر سالاد سبز.', price:290000, color:'#7C8C3E'},
    {id:'caesar',   name:'سس سزار',       desc:'مکمل بی نقص و مخصوص سالاد محبوب سزار', price:290000, color:'#EDE6D6'},
    {id:'entree',   name:'آنتراکت',       desc:'سس مخصوص انواع  ساندویچ گرم', price:290000, color:'#EDE6D6'},
    
  ];

  let products = DEFAULT_PRODUCTS.map(p => ({...p}));
  let cart = [];        // {id, qty} — per-visit only
  let orders = [];       // loaded from shared storage when admin opens
  let chatMessages = [{from:'bot', text:'سلام! به سس بانو خوش اومدید 🌿 چطور می‌تونم کمکتون کنم؟'}];
  let isAdmin = false;
  let chatLoaded = false;

  // ---------------- Customer identity (username + phone, verified by SMS code) ----------------
  let customer = null;          // {token, username, phone} once verified
  let pendingIdentity = null;   // {username, phone} while waiting for the SMS code
  let pendingOrderAfterAuth = false;

  function loadCustomerFromStorage(){
    try {
      const raw = localStorage.getItem('sosbanoo_customer');
      customer = raw ? JSON.parse(raw) : null;
    } catch(_) { customer = null; }
  }

  function saveCustomerToStorage(){
    try {
      if(customer) localStorage.setItem('sosbanoo_customer', JSON.stringify(customer));
      else localStorage.removeItem('sosbanoo_customer');
    } catch(_) {}
  }

  function updateIdentityUI(){
    const banner = document.getElementById('identity-banner');
    const badge = document.getElementById('identity-badge');
    const nameInput = document.getElementById('c-name');
    const phoneInput = document.getElementById('c-phone');
    if(!banner || !badge || !nameInput || !phoneInput) return; // defensive: don't let a missing element break init()
    if(customer){
      banner.style.display = 'none';
      badge.classList.add('show');
      const badgeName = document.getElementById('identity-badge-name');
      const badgePhone = document.getElementById('identity-badge-phone');
      if(badgeName) badgeName.textContent = customer.username;
      if(badgePhone) badgePhone.textContent = customer.phone;
      nameInput.value = customer.username;
      phoneInput.value = customer.phone;
    } else {
      banner.style.display = 'flex';
      badge.classList.remove('show');
      nameInput.value = '';
      phoneInput.value = '';
    }
  }

  function logoutCustomer(){
    customer = null;
    saveCustomerToStorage();
    updateIdentityUI();
    showToast('از حساب خارج شدید');
  }

  function openIdentityModal(){
    document.getElementById('identity-modal').classList.add('open');
    document.getElementById('identity-step-form').style.display = 'block';
    document.getElementById('identity-step-code').style.display = 'none';
    document.getElementById('identity-error').textContent = '';
    document.getElementById('identity-code-error').textContent = '';
    if(customer){
      document.getElementById('id-username').value = customer.username;
      document.getElementById('id-phone').value = customer.phone;
    }
  }

  function closeIdentityModal(){
    document.getElementById('identity-modal').classList.remove('open');
    pendingOrderAfterAuth = false;
  }

  async function requestOtp(isResend){
    const errEl = document.getElementById('identity-error');
    errEl.textContent = '';
    let username, phone;
    if(isResend && pendingIdentity){
      ({username, phone} = pendingIdentity);
    } else {
      username = document.getElementById('id-username').value.trim();
      phone = document.getElementById('id-phone').value.trim().replace(/[^0-9]/g, '');
    }
    if(!username){ errEl.textContent = 'نام و نام‌خانوادگی را وارد کنید.'; return; }
    if(!/^09\d{9}$/.test(phone)){ errEl.textContent = 'شماره موبایل معتبر نیست.'; return; }

    const btn = document.getElementById('id-send-btn');
    if(btn) btn.disabled = true;
    try{
      const response = await fetch(`${ADMIN_API}/api/auth/request-otp`, {
        method:'POST',
        headers:{'Content-Type':'application/json','Accept':'application/json'},
        body: JSON.stringify({username, phone}),
        cache:'no-store'
      });
      const data = await response.json().catch(() => ({}));
      if(!response.ok) throw new Error(data.error || 'ارسال کد ناموفق بود.');
      pendingIdentity = {username, phone};
      document.getElementById('identity-step-form').style.display = 'none';
      document.getElementById('identity-step-code').style.display = 'block';
      document.getElementById('identity-sent-phone').textContent = phone;
      document.getElementById('id-code').value = '';
      document.getElementById('identity-code-error').textContent = '';
      showToast(isResend ? 'کد جدید ارسال شد' : 'کد تایید ارسال شد');
    }catch(err){
      console.error('Request OTP failed', err);
      errEl.textContent = err.message || 'ارسال کد تایید ناموفق بود.';
    }finally{
      if(btn) btn.disabled = false;
    }
  }

  function backToIdentityForm(){
    document.getElementById('identity-step-code').style.display = 'none';
    document.getElementById('identity-step-form').style.display = 'block';
    document.getElementById('identity-error').textContent = '';
    if(pendingIdentity){
      document.getElementById('id-username').value = pendingIdentity.username;
      document.getElementById('id-phone').value = pendingIdentity.phone;
    }
  }

  async function verifyOtp(){
    const errEl = document.getElementById('identity-code-error');
    errEl.textContent = '';
    if(!pendingIdentity){ errEl.textContent = 'ابتدا کد را درخواست کنید.'; return; }
    const code = document.getElementById('id-code').value.trim();
    if(!code){ errEl.textContent = 'کد تایید را وارد کنید.'; return; }

    const btn = document.getElementById('id-verify-btn');
    if(btn) btn.disabled = true;
    try{
      const response = await fetch(`${ADMIN_API}/api/auth/verify-otp`, {
        method:'POST',
        headers:{'Content-Type':'application/json','Accept':'application/json'},
        body: JSON.stringify({phone: pendingIdentity.phone, code}),
        cache:'no-store'
      });
      const data = await response.json().catch(() => ({}));
      if(!response.ok || !data.token) throw new Error(data.error || 'تایید کد ناموفق بود.');
      customer = {token:data.token, username:data.username, phone:data.phone};
      saveCustomerToStorage();
      updateIdentityUI();
      pendingIdentity = null;
      closeIdentityModal();
      showToast(`خوش اومدید، ${customer.username}!`);
      if(pendingOrderAfterAuth){
        pendingOrderAfterAuth = false;
        await submitOrder();
      }
    }catch(err){
      console.error('Verify OTP failed', err);
      errEl.textContent = err.message || 'کد وارد شده اشتباه است.';
    }finally{
      if(btn) btn.disabled = false;
    }
  }
  function getSessionId(){
    try {
      let id = localStorage.getItem('sosbanoo_chat_session');
      if(!id){
        id = 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('sosbanoo_chat_session', id);
      }
      return id;
    } catch(_) {
      return 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }
  }
  const sessionId = getSessionId();

  const fa = n => Number(n).toLocaleString('fa-IR');
  const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  // ---------------- Shared Cloudflare/D1 storage ----------------
  async function apiFetch(path, options = {}){
    const headers = { 'Accept':'application/json', ...(options.headers || {}) };
    const token = adminToken();
    if(token) headers['Authorization'] = `Bearer ${token}`;
    if(options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${ADMIN_API}${path}`, { ...options, headers, cache:'no-store' });
    const data = await response.json().catch(() => ({}));
    if(!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  async function loadProducts(){
    // Products remain local to the admin browser in this version.
    try {
      const raw = localStorage.getItem('sosbanoo_products');
      products = raw ? JSON.parse(raw) : DEFAULT_PRODUCTS.map(p => ({...p}));
    } catch(_) { products = DEFAULT_PRODUCTS.map(p => ({...p})); }
    if(!Array.isArray(products) || !products.length) products = DEFAULT_PRODUCTS.map(p => ({...p}));
  }

  async function saveProducts(){
    try { localStorage.setItem('sosbanoo_products', JSON.stringify(products)); } catch(_) {}
  }

  async function loadOrders(){
    if(!isAdmin) { orders = []; return; }
    try {
      const data = await apiFetch('/api/orders');
      orders = Array.isArray(data.orders) ? data.orders : [];
    } catch(err) {
      console.error('Orders load failed', err);
      orders = [];
      showToast('دریافت سفارش‌ها ناموفق بود');
    }
  }

  async function saveOrderToServer(order){
    const headers = {'Content-Type':'application/json','Accept':'application/json'};
    if(customer?.token) headers['Authorization'] = `Bearer ${customer.token}`;
    const response = await fetch(`${ADMIN_API}/api/orders`, {
      method:'POST', headers, body: JSON.stringify(order), cache:'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if(!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  async function loadChatSession(){
    try {
      const data = await apiFetch(`/api/chat?sessionId=${encodeURIComponent(sessionId)}`);
      const messages = Array.isArray(data.messages) ? data.messages : [];
      chatMessages = messages.map(m => ({from: m.sender === 'user' ? 'user' : (m.sender === 'admin' ? 'admin' : 'bot'), text:m.text, time:m.time}));
      if(!chatMessages.length) chatMessages = [{from:'bot', text:'سلام! به سس بانو خوش اومدید 🌿 چطور می‌تونم کمکتون کنم؟'}];
    } catch(err) {
      console.error('Chat load failed', err);
    }
  }

  async function saveCustomerMessage(text, time){
    return apiFetch('/api/chat', {
      method:'POST',
      body: JSON.stringify({sessionId, text, time})
    });
  }

  async function sendToFormspree(data){
    if(!FORMSPREE_ENDPOINT || FORMSPREE_ENDPOINT.includes('YOUR_FORM_ID')) return false;
    const response = await fetch(FORMSPREE_ENDPOINT, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
      body: JSON.stringify(data)
    });
    if(!response.ok){
      let detail = '';
      try { detail = JSON.stringify(await response.json()); } catch(_) {}
      throw new Error(`Formspree HTTP ${response.status} ${detail}`);
    }
    return true;
  }

  // ---------------- Products render (storefront) ----------------
  function renderProducts(){
    const grid = document.getElementById('product-grid');
    grid.innerHTML = products.map(p => `
      <div class="p-card">
        <div class="dab" style="background:${p.color}"></div>
        <h3>${escapeHtml(p.name)}</h3>
        <p class="desc">${escapeHtml(p.desc)}</p>
        <div class="row">
          <span class="price">${fa(p.price)} تومان</span>
          <button class="add-btn" onclick="addToCart('${p.id}')">افزودن به سفارش</button>
        </div>
      </div>
    `).join('');
  }

  // ---------------- Cart ----------------
  function addToCart(id){
    const line = cart.find(c => c.id === id);
    if(line){ line.qty += 1; } else { cart.push({id, qty:1}); }
    renderCart();
    const p = products.find(p => p.id === id);
    showToast(`«${p.name}» به سبد اضافه شد`);
  }

  function changeQty(id, delta){
    const line = cart.find(c => c.id === id);
    if(!line) return;
    line.qty += delta;
    if(line.qty <= 0){ cart = cart.filter(c => c.id !== id); }
    renderCart();
  }

  function removeFromCart(id){
    cart = cart.filter(c => c.id !== id);
    renderCart();
  }

  function renderCart(){
    const list = document.getElementById('cart-items');
    const empty = document.getElementById('cart-empty');
    const totalRow = document.getElementById('cart-total-row');
    const countEl = document.getElementById('cart-count');

    const totalItems = cart.reduce((s,c) => s + c.qty, 0);
    countEl.textContent = fa(totalItems);

    if(cart.length === 0){
      list.innerHTML = '';
      empty.style.display = 'block';
      totalRow.style.display = 'none';
      return;
    }
    empty.style.display = 'none';
    totalRow.style.display = 'flex';

    let total = 0;
    list.innerHTML = cart.map(c => {
      const p = products.find(p => p.id === c.id);
      if(!p) return '';
      const lineTotal = p.price * c.qty;
      total += lineTotal;
      return `
        <li>
          <div>
            <div class="nm">${escapeHtml(p.name)}</div>
            <div class="sub">${fa(p.price)} تومان × ${fa(c.qty)}</div>
          </div>
          <div class="qty-ctrl">
            <button onclick="changeQty('${p.id}', -1)">−</button>
            <span>${fa(c.qty)}</span>
            <button onclick="changeQty('${p.id}', 1)">+</button>
            <button class="remove-x" onclick="removeFromCart('${p.id}')">حذف</button>
          </div>
        </li>
      `;
    }).join('');
    document.getElementById('cart-total').textContent = `${fa(total)} تومان`;
  }

  // ---------------- Checkout ----------------
  document.getElementById('checkout-form').addEventListener('submit', async function(e){
    e.preventDefault();
    if(cart.length === 0){
      showToast('سبد سفارش شما خالی است');
      return;
    }
    if(!customer){
      pendingOrderAfterAuth = true;
      openIdentityModal();
      return;
    }
    await submitOrder();
  });

  async function submitOrder(){
    const form = document.getElementById('checkout-form');
    const name = customer.username;
    const phone = customer.phone;
    const address = document.getElementById('c-address').value.trim();
    const note = document.getElementById('c-note').value.trim();
    if(!address){
      showToast('آدرس ارسال را وارد کنید');
      return;
    }

    const items = cart.map(c => {
      const p = products.find(p => p.id === c.id);
      return {name:p.name, qty:c.qty, price:p.price};
    });
    const total = items.reduce((s,i) => s + i.price * i.qty, 0);
    const order = {
      id: Date.now(),
      time: new Date().toLocaleString('fa-IR'),
      name, phone, address, note, items, total
    };

    // Save on Cloudflare D1 so the order is visible from every admin device.
    try {
      await saveOrderToServer(order);
    } catch(err) {
      console.error('D1 order save failed', err);
      showToast('ثبت سفارش ناموفق بود؛ دوباره تلاش کنید');
      return;
    }
    if(isAdmin) await renderAdminOrders();

    // Send a copy to Formspree. The order remains locally saved even if
    // the network is temporarily unavailable.
    let sent = false;
    try{
      sent = await sendToFormspree({
        type: 'order',
        subject: `سفارش جدید از سس بانو - ${name}`,
        'نام مشتری': name,
        'شماره تماس': phone,
        'آدرس': address,
        'یادداشت': note || '—',
        'اقلام سفارش': items.map(i => `${i.name} × ${fa(i.qty)} (${fa(i.price)} تومان)`).join('، '),
        'جمع کل': `${fa(total)} تومان`,
        'شماره سفارش': String(order.id),
        'زمان': order.time
      });
    }catch(err){
      console.error('Formspree order submit failed', err);
      showToast('سفارش ثبت شد، اما ارسال به فرم‌اسپری ناموفق بود');
    }

    cart = [];
    renderCart();
    form.reset();
    form.style.display = 'none';
    document.getElementById('order-confirm').classList.add('show');

    setTimeout(() => {
      form.style.display = 'block';
      document.getElementById('order-confirm').classList.remove('show');
    }, 4500);
  }

  // ---------------- Chat ----------------
  const botReplies = [
    'پیامتون ثبت شد، همکارامون به‌زودی جواب می‌دن 🌿',
    'ممنون که با سس بانو در ارتباطید! چند لحظه صبر کنید.',
    'حتماً پیگیری می‌کنیم و در همین چت پاسخ می‌دیم.'
  ];

  async function toggleChat(force){
    const panel = document.getElementById('chat-panel');
    const shouldOpen = typeof force === 'boolean' ? force : !panel.classList.contains('open');
    panel.classList.toggle('open', shouldOpen);
    if(!shouldOpen) return;
    await loadChatSession();
    renderChat();
  }

  async function sendMessage(){
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if(!text) return;
    const time = new Date().toLocaleString('fa-IR');
    const userMsg = {sessionId, from:'user', text, time};
    try {
      await saveCustomerMessage(text, time);
      chatMessages.push(userMsg);
      input.value = '';
      renderChat();
    } catch(err) {
      console.error('Customer message save failed', err);
      showToast('ارسال پیام ناموفق بود');
      return;
    }

    try{
      await sendToFormspree({
        type: 'message',
        subject: 'پیام جدید از سایت سس بانو',
        'پیام': text,
        'شناسه نشست': sessionId,
        'زمان': time
      });
    }catch(err){
      console.error('Formspree message submit failed', err);
    }
  }

  let chatPollTimer = null;
  async function pollChat(){
    if(!document.getElementById('chat-panel').classList.contains('open')) return;
    await loadChatSession();
    renderChat();
  }
  if(!chatPollTimer) chatPollTimer = setInterval(pollChat, 3000);

  function renderChat(){
    const box = document.getElementById('chat-messages');
    box.innerHTML = chatMessages.map(m => `
      <div class="chat-row ${m.from}">
        <div class="bubble">
          <div class="bubble-text">${escapeHtml(m.text)}</div>
          ${m.time ? `<div class="bubble-time">${escapeHtml(m.time)}</div>` : ''}
        </div>
      </div>
    `).join('');
    box.scrollTop = box.scrollHeight;
  }

  // ---------------- Toast ----------------
  let toastTimer;
  function showToast(msg){
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------------- Admin ----------------
  // The password is NEVER stored in this public JavaScript file.
  // Authentication is handled by the Cloudflare Worker.
  function adminToken(){
    try { return sessionStorage.getItem('sosbanoo_admin_token') || ''; }
    catch(e) { return ''; }
  }

  async function verifyAdminToken(){
    const token = adminToken();
    if(!token) return false;
    try{
      const response = await fetch(`${ADMIN_API}/api/auth/verify`, {
        headers: { 'Authorization': `Bearer ${token}` },
        cache: 'no-store'
      });
      if(!response.ok){
        try { sessionStorage.removeItem('sosbanoo_admin_token'); } catch(_) {}
        return false;
      }
      return true;
    }catch(err){
      console.error('Admin token verification failed', err);
      return false;
    }
  }

  async function openAdmin(){
    document.getElementById('admin-panel').classList.add('open');
    document.body.style.overflow = 'hidden';
    if(isAdmin || await verifyAdminToken()){
      isAdmin = true;
      showAdminDashboard();
    } else {
      document.getElementById('admin-login-view').style.display = 'block';
      document.getElementById('admin-dashboard-view').style.display = 'none';
      setTimeout(() => document.getElementById('admin-pass').focus(), 300);
    }
  }
  function closeAdmin(){
    document.getElementById('admin-panel').classList.remove('open');
    document.body.style.overflow = '';
  }

  function showAdminDashboard(){
    document.getElementById('admin-login-view').style.display = 'none';
    document.getElementById('admin-dashboard-view').style.display = 'block';
    renderAdminProducts();
    renderAdminOrders();
    renderAdminChat();
  }

  document.getElementById('admin-form').addEventListener('submit', async function(e){
    e.preventDefault();
    const val = document.getElementById('admin-pass').value;
    const errEl = document.getElementById('admin-error');
    const submitBtn = this.querySelector('button[type="submit"]');
    if(!val) return;
    if(submitBtn) submitBtn.disabled = true;
    errEl.classList.remove('show');
    try{
      const response = await fetch(`${ADMIN_API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ password: val }),
        cache: 'no-store'
      });
      const data = await response.json().catch(() => ({}));
      if(!response.ok || !data.token) throw new Error('login_failed');
      sessionStorage.setItem('sosbanoo_admin_token', data.token);
      isAdmin = true;
      document.getElementById('admin-pass').value = '';
      showAdminDashboard();
    }catch(err){
      console.error('Admin login failed', err);
      errEl.textContent = 'ورود ناموفق بود. رمز را بررسی کنید یا اتصال اینترنت را دوباره امتحان کنید.';
      errEl.classList.add('show');
      const card = document.querySelector('.admin-login-card');
      card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
    }finally{
      if(submitBtn) submitBtn.disabled = false;
    }
  });

  function logoutAdmin(){
    isAdmin = false;
    try { sessionStorage.removeItem('sosbanoo_admin_token'); } catch(_) {}
    closeAdmin();
  }

  function switchAdminTab(tab){
    document.getElementById('tab-btn-orders').classList.toggle('active', tab === 'orders');
    document.getElementById('tab-btn-chat').classList.toggle('active', tab === 'chat');
    document.getElementById('tab-btn-products').classList.toggle('active', tab === 'products');
    document.getElementById('pane-orders').classList.toggle('active', tab === 'orders');
    document.getElementById('pane-chat').classList.toggle('active', tab === 'chat');
    document.getElementById('pane-products').classList.toggle('active', tab === 'products');
  }

  async function renderAdminOrders(){
    const pane = document.getElementById('pane-orders');
    pane.innerHTML = '<p class="empty-note">در حال بارگذاری سفارش‌ها...</p>';
    await loadOrders();
    if(orders.length === 0){
      pane.innerHTML = '<p class="empty-note">هنوز سفارشی ثبت نشده است.</p>';
      return;
    }
    pane.innerHTML = orders.map(o => `
      <div class="admin-order-card">
        <div class="top">
          <span>${escapeHtml(o.time)}</span>
          <span>#${escapeHtml(o.id)}</span>
          <button class="order-delete-btn" onclick="deleteOrder('${escapeHtml(o.id)}')" title="حذف سفارش">حذف</button>
        </div>
        <div class="name">${escapeHtml(o.name)} — ${escapeHtml(o.phone)}</div>
        <div style="font-size:13.5px; opacity:.7; margin-top:4px;">${escapeHtml(o.address)}${o.note ? ' · ' + escapeHtml(o.note) : ''}</div>
        <ul>${(o.items || []).map(i => `<li>${escapeHtml(i.name)} × ${fa(i.qty)} — ${fa(i.price * i.qty)} تومان</li>`).join('')}</ul>
        <div class="total">جمع: ${fa(o.total)} تومان</div>
      </div>
    `).join('');
  }

  async function deleteOrder(orderId){
    if(!confirm('این سفارش برای همیشه حذف بشه؟')) return;
    try {
      await apiFetch(`/api/orders/${encodeURIComponent(orderId)}`, { method:'DELETE' });
      await renderAdminOrders();
      showToast('سفارش حذف شد');
    } catch(err) {
      console.error('Delete order failed', err);
      showToast('حذف سفارش ناموفق بود');
    }
  }

  // ---------------- Admin chat: messenger-style (conversation list + open thread) ----------------
  let messengerGroups = {};      // {sessionId: [messages]}
  let activeConversation = null; // currently open sessionId
  let messengerPollTimer = null;

  async function renderAdminChat(){
    const list = document.getElementById('messenger-list');
    const firstLoad = Object.keys(messengerGroups).length === 0;
    if(firstLoad) list.innerHTML = '<p class="empty-note">در حال بارگذاری مکالمات...</p>';
    try {
      const data = await apiFetch('/api/admin/chats');
      const all = Array.isArray(data.messages) ? data.messages : [];
      const groups = {};
      all.forEach(m => { (groups[m.session_id] = groups[m.session_id] || []).push(m); });
      messengerGroups = groups;
      renderMessengerList();
      if(activeConversation && groups[activeConversation]) renderThread(activeConversation);
      if(!messengerPollTimer){
        messengerPollTimer = setInterval(() => {
          if(document.getElementById('admin-panel').classList.contains('open') &&
             document.getElementById('tab-btn-chat').classList.contains('active')) renderAdminChat();
        }, 5000);
      }
    } catch(err) {
      console.error('Admin chat load failed', err);
      if(firstLoad) list.innerHTML = '<p class="empty-note">دریافت مکالمات ناموفق بود.</p>';
    }
  }

  function renderMessengerList(){
    const list = document.getElementById('messenger-list');
    const ids = Object.keys(messengerGroups);
    if(ids.length === 0){
      list.innerHTML = '<p class="empty-note">هنوز مکالمه‌ای ثبت نشده است.</p>';
      return;
    }
    list.innerHTML = ids.map((sid, idx) => {
      const msgs = messengerGroups[sid];
      const last = msgs[msgs.length - 1];
      return `
        <div class="conv-item ${sid === activeConversation ? 'active' : ''}" onclick="openConversation('${escapeHtml(sid)}')">
          <div class="conv-item-top">
            <div class="conv-name">مشتری ${fa(idx + 1)}</div>
            <button class="conv-delete-btn" onclick="event.stopPropagation(); deleteConversation('${escapeHtml(sid)}')" title="حذف مکالمه">×</button>
          </div>
          <div class="conv-preview">${escapeHtml(last ? last.text : '')}</div>
        </div>
      `;
    }).join('');
  }

  async function deleteConversation(sessionIdValue){
    if(!confirm('کل این مکالمه برای همیشه حذف بشه؟')) return;
    try {
      await apiFetch(`/api/admin/chat/session/${encodeURIComponent(sessionIdValue)}`, { method:'DELETE' });
      if(activeConversation === sessionIdValue){
        activeConversation = null;
        document.getElementById('messenger-thread').innerHTML = '<p class="empty-note">یک مکالمه را از سمت راست انتخاب کنید.</p>';
      }
      await renderAdminChat();
      showToast('مکالمه حذف شد');
    } catch(err) {
      console.error('Delete conversation failed', err);
      showToast('حذف مکالمه ناموفق بود');
    }
  }

  function openConversation(sessionIdValue){
    activeConversation = sessionIdValue;
    renderMessengerList();
    renderThread(sessionIdValue);
  }

  function renderThread(sessionIdValue){
    const thread = document.getElementById('messenger-thread');
    const msgs = messengerGroups[sessionIdValue] || [];

    // Preserve whatever the admin is currently typing, and scroll position,
    // so the 5-second poll doesn't wipe an in-progress reply.
    const prevInput = document.getElementById('thread-reply-input');
    const draft = prevInput ? prevInput.value : '';
    const hadFocus = !!prevInput && document.activeElement === prevInput;
    const cursorPos = prevInput ? prevInput.selectionStart : null;
    const prevBox = document.getElementById('thread-messages');
    const wasAtBottom = !prevBox || (prevBox.scrollHeight - prevBox.scrollTop - prevBox.clientHeight < 40);

    thread.innerHTML = `
      <div class="thread-messages" id="thread-messages">
        ${msgs.map(m => `
          <div class="thread-row ${m.sender === 'user' ? 'user' : 'admin'}">
            <div class="thread-bubble">
              <button class="bubble-del" onclick="deleteChatMessage('${escapeHtml(m.id)}')" title="حذف پیام">×</button>
              <div>${escapeHtml(m.text)}</div>
              <div class="bubble-time">${escapeHtml(m.time)}</div>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="thread-reply-row">
        <input id="thread-reply-input" placeholder="پاسخ به مشتری..." value="${escapeHtml(draft)}" onkeydown="if(event.key==='Enter'){replyToChat('${escapeHtml(sessionIdValue)}')}">
        <button onclick="replyToChat('${escapeHtml(sessionIdValue)}')">ارسال</button>
      </div>
    `;

    const box = document.getElementById('thread-messages');
    if(wasAtBottom) box.scrollTop = box.scrollHeight;

    const newInput = document.getElementById('thread-reply-input');
    if(hadFocus && newInput){
      newInput.focus();
      if(cursorPos !== null) newInput.setSelectionRange(cursorPos, cursorPos);
    }
  }

  async function deleteChatMessage(messageId){
    if(!confirm('این پیام حذف شود؟')) return;
    try {
      await apiFetch(`/api/admin/chat/message/${encodeURIComponent(messageId)}`, { method:'DELETE' });
      await renderAdminChat();
      showToast('پیام حذف شد');
    } catch(err) {
      console.error('Delete chat message failed', err);
      showToast('حذف پیام ناموفق بود');
    }
  }

  async function replyToChat(sessionIdValue){
    const input = document.getElementById('thread-reply-input');
    const text = input.value.trim();
    if(!text) return;
    input.disabled = true;
    try {
      await apiFetch('/api/admin/chat/reply', {
        method:'POST',
        body:JSON.stringify({sessionId:sessionIdValue, text, time:new Date().toLocaleString('fa-IR')})
      });
      await renderAdminChat();
      openConversation(sessionIdValue);
    } catch(err) {
      console.error('Admin reply failed', err);
      showToast('ارسال پاسخ ناموفق بود');
    } finally {
      const freshInput = document.getElementById('thread-reply-input');
      if(freshInput){ freshInput.disabled = false; freshInput.focus(); }
    }
  }

  function renderAdminProducts(){
    const pane = document.getElementById('pane-products');
    pane.innerHTML = products.map(p => `
      <div class="padmin-card" data-id="${p.id}">
        <div class="dab" style="background:${p.color}"></div>
        <div class="p-name-price">
          <input type="text" value="${escapeHtml(p.name)}" data-field="name" placeholder="نام محصول">
          <input type="number" value="${p.price}" data-field="price" placeholder="قیمت">
        </div>
        <div class="p-desc-color">
          <textarea data-field="desc">${escapeHtml(p.desc)}</textarea>
          <input type="color" value="${p.color}" data-field="color">
        </div>
        <button class="padmin-save" onclick="saveProductEdit('${p.id}', this)">ذخیره</button>
        <button class="padmin-del" onclick="deleteProduct('${p.id}')">حذف</button>
      </div>
    `).join('') + `
      <div class="padmin-add-box">
        <h4>افزودن محصول جدید</h4>
        <div class="padmin-add-grid">
          <input type="text" id="new-p-name" placeholder="نام محصول">
          <input type="number" id="new-p-price" placeholder="قیمت (تومان)">
          <textarea id="new-p-desc" placeholder="توضیح کوتاه"></textarea>
          <input type="color" id="new-p-color" value="#C1391D">
        </div>
        <button class="padmin-save" onclick="addProduct()">افزودن محصول</button>
      </div>
    `;
  }

  async function saveProductEdit(id, btnEl){
    const card = btnEl.closest('.padmin-card');
    const p = products.find(x => x.id === id);
    if(!p) return;
    p.name  = card.querySelector('[data-field="name"]').value.trim() || p.name;
    p.price = Number(card.querySelector('[data-field="price"]').value) || p.price;
    p.desc  = card.querySelector('[data-field="desc"]').value.trim() || p.desc;
    p.color = card.querySelector('[data-field="color"]').value || p.color;
    await saveProducts();
    renderProducts();
    showToast(`«${p.name}» به‌روزرسانی شد`);
  }

  async function deleteProduct(id){
    const p = products.find(x => x.id === id);
    products = products.filter(x => x.id !== id);
    cart = cart.filter(c => c.id !== id);
    await saveProducts();
    renderProducts();
    renderCart();
    renderAdminProducts();
    showToast(p ? `«${p.name}» حذف شد` : 'محصول حذف شد');
  }

  async function addProduct(){
    const name = document.getElementById('new-p-name').value.trim();
    const price = Number(document.getElementById('new-p-price').value);
    const desc = document.getElementById('new-p-desc').value.trim();
    const color = document.getElementById('new-p-color').value || '#C1391D';
    if(!name || !price){
      showToast('نام و قیمت محصول را وارد کنید');
      return;
    }
    let id = name.trim().toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, '-').replace(/^-+|-+$/g, '');
    if(!id || products.some(p => p.id === id)) id = 'p-' + Date.now();
    products.push({id, name, desc: desc || '—', price, color});
    await saveProducts();
    renderProducts();
    renderAdminProducts();
    showToast(`«${name}» اضافه شد`);
  }

  // ---------------- Init ----------------
  (async function init(){
    document.getElementById('product-grid').innerHTML = '<p class="empty-note">در حال بارگذاری محصولات...</p>';
    try { loadCustomerFromStorage(); updateIdentityUI(); }
    catch(err) { console.error('Identity init failed', err); }
    try { await loadProducts(); }
    catch(err) { console.error('Load products failed', err); }
    try { renderProducts(); }
    catch(err) { console.error('Render products failed', err); }
    try { renderCart(); }
    catch(err) { console.error('Render cart failed', err); }
  })();