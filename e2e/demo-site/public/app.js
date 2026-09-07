// Minimal SPA for the demo store. Uses History API so the snippet's SPA
// route-change capture is exercised. Arabic-first, with a deliberately
// awkward checkout (used as a struggle fixture in slice 2).

const PRODUCTS = [
  { id: "p1", name: "عباية كلاسيكية", price: 320 },
  { id: "p2", name: "بخور فاخر", price: 145 },
  { id: "p3", name: "ساعة يد", price: 890 },
  { id: "p4", name: "حقيبة جلد", price: 460 },
];

const app = document.getElementById("app");

function go(path) {
  history.pushState({}, "", path);
  render();
}

function render() {
  const path = location.pathname;
  if (path.startsWith("/products")) return renderProducts();
  if (path.startsWith("/product/")) return renderProduct(path.split("/")[2]);
  if (path.startsWith("/cart")) return renderCart();
  if (path.startsWith("/checkout")) return renderCheckout();
  return renderHome();
}

function renderHome() {
  app.innerHTML = `
    <h2>أهلاً بك في متجر تراكي</h2>
    <p>تسوّق أفضل المنتجات في الخليج.</p>
    <button id="cta">تصفّح المنتجات</button>`;
  document.getElementById("cta").onclick = () => go("/products");
}

function renderProducts() {
  app.innerHTML = `<h2>المنتجات</h2><div class="grid">${PRODUCTS.map(
    (p) => `
    <div class="card">
      <h3>${p.name}</h3>
      <p class="price">${p.price} ر.س</p>
      <button data-id="${p.id}">عرض</button>
    </div>`,
  ).join("")}</div>`;
  app.querySelectorAll("button[data-id]").forEach((b) => {
    b.onclick = () => go("/product/" + b.getAttribute("data-id"));
  });
}

function renderProduct(id) {
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) return renderProducts();
  app.innerHTML = `
    <div class="card">
      <h2>${p.name}</h2>
      <p class="price">${p.price} ر.س</p>
      <button id="add">أضف إلى السلة</button>
    </div>`;
  document.getElementById("add").onclick = () => {
    window.tracki && window.tracki.track("add_to_cart", { productId: p.id, price: p.price });
    go("/cart");
  };
}

function renderCart() {
  app.innerHTML = `
    <h2>سلة التسوّق</h2>
    <div class="card"><p>لديك منتجات في سلتك.</p>
    <button id="checkout">إتمام الشراء</button></div>`;
  document.getElementById("checkout").onclick = () => go("/checkout");
}

function renderCheckout() {
  app.innerHTML = `
    <h2>إتمام الشراء</h2>
    <form id="checkout-form" class="card">
      <label for="name">الاسم الكامل</label>
      <input id="name" name="name" required />
      <label for="coupon">رمز الخصم</label>
      <input id="coupon" name="coupon" placeholder="اختياري" />
      <label for="card">رقم البطاقة</label>
      <input id="card" name="card" inputmode="numeric" required />
      <button type="submit">ادفع الآن</button>
    </form>`;
  document.getElementById("checkout-form").onsubmit = (e) => {
    e.preventDefault();
    window.tracki && window.tracki.track("purchase", { total: 320 });
    app.innerHTML = "<h2>شكراً لك! تم استلام طلبك.</h2>";
  };
}

document.getElementById("faq-btn").onclick = () => {
  window.tracki && window.tracki.faq();
};

document.getElementById("login-btn").onclick = () => {
  // Identify with a stable demo user id.
  window.tracki && window.tracki.identify("user_demo_1", { plan: "gold" });
  document.getElementById("login-btn").textContent = "مرحباً 👤";
};

document.querySelectorAll("nav a[data-nav]").forEach((a) => {
  a.onclick = (e) => {
    e.preventDefault();
    go(a.getAttribute("href"));
  };
});

window.addEventListener("popstate", render);
render();
