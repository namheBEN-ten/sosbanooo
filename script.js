// =========================================================
  // Formspree — real email delivery for the order form.
  // 1) Go to https://formspree.io and create a free form.
  // 2) Copy the endpoint it gives you (looks like
  //    https://formspree.io/f/abcdwxyz) and paste it below.
  // Until you do, orders still save inside the site + admin
  // panel, but no email will be sent.
  // =========================================================
  const FORMSPREE_ENDPOINT = 'https://formspree.io/f/YOUR_FORM_ID';

  // ---------------- Data ----------------
  const DEFAULT_PRODUCTS = [
    {id:'mango',    name:'سس انبه',      desc:'ترش‌وشیرین با رایحه‌ی انبه‌های رسیده، مناسب کباب و مرغ.', price:48000, color:'#F2994A'},
    {id:'ketchup',  name:'سس کچاپ',      desc:'گوجه‌ی رسیده و طعمی آشنا، همراه همیشگی سیب‌زمینی و پیتزا.', price:35000, color:'#C1391D'},
    {id:'pizza',    name:'سس پیتزا',     desc:'پایه‌ی غلیظ گوجه با ادویه‌ی مدیترانه‌ای، برای پیتزای خانگی.', price:52000, color:'#8C2F1B'},
    {id:'sandwich', name:'سس ساندویچ',   desc:'کِرمی و ملایم، طعم‌دهنده‌ی هر ساندویچ روزمره.', price:42000, color:'#D98E04'},
    {id:'garlic',   name:'سس سیر',       desc:'تند و معطر، برای عاشقان طعم سیر تازه.', price:38000, color:'#EDE6D6'},
    {id:'pesto',    name:'سس پستو',      desc:'ریحان تازه، روغن زیتون و مغزیجات، اصیل و خوش‌عطر.', price:65000, color:'#5B6F3A'},
    {id:'salad',    name:'سس سالاد',     desc:'سبک و تازه، مکمل بی‌نقص هر سالاد سبز.', price:40000, color:'#7C8C3E'},
  ];

  let products = DEFAULT_PRODUCTS.map(p => ({...p}));
  let cart = [];        // {id, qty} — per-visit only
  let orders = [];       // loaded from shared storage when admin opens
  let chatMessages = [{from:'bot', text:'سلام! به سس بانو خوش اومدید 🌿 چطور می‌تونم کمکتون کنم؟'}];
  let isAdmin = false;
  let chatLoaded = false;
  const sessionId = 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const fa = n => Number(n).toLocaleString('fa-IR');
  const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  // ---------------- Shared storage helpers ----------------
  // Note: this uses this artifact's built-in storage, so products/orders/chat
  // are shared between everyone who opens this page from Claude.
  async function loadProducts(){
    try{
      const r = await window.storage.get('products', true);
      if(r && r.value){ products = JSON.parse(r.value); return; }
    }catch(e){ /* nothing saved yet */ }
    products = DEFAULT_PRODUCTS.map(p => ({...p}));
    saveProducts();
  }
  async function saveProducts(){
    try{ await window.storage.set('products', JSON.stringify(products), true); }
    catch(e){ console.error(e); showToast('ذخیره‌ی محصولات با خطا مواجه شد'); }
  }

  async function loadOrders(){
    try{
      const r = await window.storage.get('orders', true);
      if(r && r.value){ orders = JSON.parse(r.value); return; }
    }catch(e){ orders = []; }
  }
  async function saveOrders(){
    try{ await window.storage.set('orders', JSON.stringify(orders), true); }
    catch(e){ console.error(e); showToast('ذخیره‌ی سفارش با خطا مواجه شد'); }
  }

  async function loadChatAll(){
    try{
      const r = await window.storage.get('chat', true);
      if(r && r.value) return JSON.parse(r.value);
    }catch(e){ /* nothing saved yet */ }
    return [];
  }
  async function saveChatAll(all){
    try{ await window.storage.set('chat', JSON.stringify(all), true); }
    catch(e){ console.error(e); }
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
    const form = this;
    const name = document.getElementById('c-name').value.trim();
    const phone = document.getElementById('c-phone').value.trim();
    const address = document.getElementById('c-address').value.trim();
    const note = document.getElementById('c-note').value.trim();

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

    // Save inside the site (shows up in the admin panel)
    orders.unshift(order);
    await saveOrders();
    if(isAdmin) renderAdminOrders();

    // Really send it — a real email via Formspree
    if(!FORMSPREE_ENDPOINT.includes('YOUR_FORM_ID')){
      try{
        await fetch(FORMSPREE_ENDPOINT, {
          method:'POST',
          headers:{'Content-Type':'application/json', 'Accept':'application/json'},
          body: JSON.stringify({
            'نام مشتری': name,
            'شماره تماس': phone,
            'آدرس': address,
            'یادداشت': note || '—',
            'اقلام سفارش': items.map(i => `${i.name} × ${fa(i.qty)}`).join('، '),
            'جمع کل': `${fa(total)} تومان`
          })
        });
      }catch(err){
        console.error('Formspree submit failed', err);
        showToast('سفارش ذخیره شد ولی ارسال ایمیل ناموفق بود');
      }
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
  });

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
    if(!chatLoaded){
      chatLoaded = true;
      const all = await loadChatAll();
      const mine = all.filter(m => m.sessionId === sessionId);
      if(mine.length) chatMessages = mine;
    }
    renderChat();
  }

  async function sendMessage(){
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if(!text) return;
    const userMsg = {sessionId, from:'user', text, time:new Date().toLocaleString('fa-IR')};
    chatMessages.push(userMsg);
    input.value = '';
    renderChat();

    const all = await loadChatAll();
    all.push(userMsg);
    await saveChatAll(all);
    if(isAdmin) renderAdminChat();

    setTimeout(async () => {
      const reply = botReplies[Math.floor(Math.random() * botReplies.length)];
      const botMsg = {sessionId, from:'bot', text: reply, time:new Date().toLocaleString('fa-IR')};
      chatMessages.push(botMsg);
      renderChat();
      const all2 = await loadChatAll();
      all2.push(botMsg);
      await saveChatAll(all2);
      if(isAdmin) renderAdminChat();
    }, 700);
  }

  function renderChat(){
    const box = document.getElementById('chat-messages');
    box.innerHTML = chatMessages.map(m => `<div class="msg ${m.from}">${escapeHtml(m.text)}</div>`).join('');
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
  const ADMIN_PASSWORD = 'avinava';

  function openAdmin(){
    document.getElementById('admin-panel').classList.add('open');
    document.body.style.overflow = 'hidden';
    if(isAdmin){
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

  document.getElementById('admin-form').addEventListener('submit', function(e){
    e.preventDefault();
    const val = document.getElementById('admin-pass').value;
    const errEl = document.getElementById('admin-error');
    if(val === ADMIN_PASSWORD){
      isAdmin = true;
      errEl.classList.remove('show');
      document.getElementById('admin-pass').value = '';
      showAdminDashboard();
    } else {
      errEl.classList.add('show');
      const card = document.querySelector('.admin-login-card');
      card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
    }
  });

  function logoutAdmin(){
    isAdmin = false;
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
    pane.innerHTML = '<p class="empty-note">در حال بارگذاری...</p>';
    await loadOrders();
    if(orders.length === 0){
      pane.innerHTML = '<p class="empty-note">هنوز سفارشی ثبت نشده است.</p>';
      return;
    }
    pane.innerHTML = orders.map(o => `
      <div class="admin-order-card">
        <div class="top"><span>${o.time}</span><span>#${o.id}</span></div>
        <div class="name">${escapeHtml(o.name)} — ${escapeHtml(o.phone)}</div>
        <div style="font-size:13.5px; opacity:.7; margin-top:4px;">${escapeHtml(o.address)}${o.note ? ' · ' + escapeHtml(o.note) : ''}</div>
        <ul>${o.items.map(i => `<li>${escapeHtml(i.name)} × ${fa(i.qty)} — ${fa(i.price * i.qty)} تومان</li>`).join('')}</ul>
        <div class="total">جمع: ${fa(o.total)} تومان</div>
      </div>
    `).join('');
  }

  async function renderAdminChat(){
    const pane = document.getElementById('pane-chat');
    pane.innerHTML = '<p class="empty-note">در حال بارگذاری...</p>';
    const all = await loadChatAll();
    if(all.length === 0){
      pane.innerHTML = '<p class="empty-note">پیامی ثبت نشده است.</p>';
      return;
    }
    const groups = {};
    all.forEach(m => { (groups[m.sessionId] = groups[m.sessionId] || []).push(m); });
    const ids = Object.keys(groups);
    pane.innerHTML = ids.map((sid, idx) => `
      <div class="admin-order-card">
        <div class="top"><span>مکالمه ${fa(idx + 1)}</span><span>${fa(groups[sid].length)} پیام</span></div>
        ${groups[sid].map(m => `<div class="admin-chat-row"><b>${m.from === 'user' ? 'مشتری' : 'ربات'}:</b> ${escapeHtml(m.text)}</div>`).join('')}
      </div>
    `).join('');
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
    await loadProducts();
    renderProducts();
    renderCart();
  })();