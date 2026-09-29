# Vivek Computer – Website + Jobs / Admit Card / Result Admin

Isme 3 cheezein judi hui hain:

1. **Top ticker** – site ke sabse upar neeli patti me nayi bharti / admit card / result chalte rehte hain.
2. **Teen box** – Hero ke neeche "नई भर्ती | एडमिट कार्ड | रिज़ल्ट". Kisi par click karo to poori detail popup me khulti hai (tareekhen, fees, vacancy, links, WhatsApp button).
3. **Admin panel** – `/admin/` par login karke post banao. SarkariResult ka link daalo to details apne-aap bhar jaati hain.

## Computer par chalana (pehli baar)

1. **Node.js** install karein (nodejs.org se "LTS" version, 18 ya usse naya).
2. Windows: `start-windows.bat` par double-click.
   Mac/Linux: terminal me is folder me jaakar `npm install` phir `npm start`.
3. Browser me kholein:
   - Website: http://localhost:3000
   - Admin: http://localhost:3000/admin/
4. **Pehli baar** terminal me ek **Admin Password** dikhega (aur `.env` file me save ho jayega). Wahi login me daalein. Badalna ho to `.env` file me `ADMIN_PASSWORD=` ke aage naya likh dein aur server dobara chalayein.

Apni images (`logo.png`, review photos, etc.) `public/` folder me `index.html` ke saath rakhein.

## Roz ka kaam (1 minute)

1. `/admin/` kholo, login karo.
2. **SarkariResult ka page link** copy karke "लिंक से भरें" me paste karo → **विवरण निकालें**.
3. Neeche form me sab jaanch lo (galat line `×` se hata do, category badalni ho to badal do) → **Publish करें**.

Post turant ticker aur box me dikhne lagti hai. Link na chale (site block kare) to form manually bhar sakte hain.

## Vercel par live karna (free)

Ye site ab Vercel ke liye taiyaar hai. Vercel par files save nahi hoti, isliye posts **Upstash Redis** (free database) me save hoti hain.

1. Folder ko **GitHub** par upload karein (naya repository -> files drag & drop). `node_modules` aur `.env` upload na karein.
2. **vercel.com** -> *Add New -> Project* -> apna GitHub repo chunein -> *Deploy*. (Framework: "Other", kuch aur badalna nahi hai.)
3. Project ke **Storage** tab me jaakar **Upstash Redis** (Marketplace) banayein aur is project se *Connect* karein. Ye `KV_REST_API_URL` aur `KV_REST_API_TOKEN` apne aap daal deta hai.
4. **Settings -> Environment Variables** me `ADMIN_PASSWORD` daalein (lamba password, 12+ characters).
5. **Deployments -> Redeploy** karein. Ho gaya: `https://aapka-project.vercel.app/admin/`

Apna domain: Vercel -> Settings -> Domains.

Dhyan dein:
- Storage connect kiye bina admin me post save nahi hogi (error aayega).
- "Link se bharo" Vercel ke servers se chalta hai; kuch sites (jo bots block karti hain) na khulein to form manually bhar dein.
- Backup: admin panel ka **Backup डाउनलोड** kabhi-kabhi le lein.

## Kisi VPS / Node hosting par (Vercel ke bina)

Start command: `npm start`, environment variables: `ADMIN_PASSWORD`, `PORT`, aur proxy ke peeche ho to `TRUST_PROXY=1`. Aisi hosting chunein jisme **disk/volume bacha rahe** (kuch free plans restart par files mita dete hain) - `data/posts.json` me posts save hoti hain.

## Dhyan rakhne wali baatein

- Link se jo details aati hain wo **draft** hain. Publish se pehle tareekhen aur links khud check karein. Auto-detect har site ke layout par 100% sahi nahi ho sakta.
- Sirf tathya (dates, fees, links) rakhein, kisi site ka poora text copy na karein, aur official notification ka link zaroor rakhein.
- "Source link" default me sirf aapko dikhta hai. Tick karne par hi visitors ko dikhega.

## Files

| File | Kaam |
|---|---|
| `lib/app.js` | Login, posts save, link se details (asli server code) |
| `server.js` | Apne computer par chalane ke liye |
| `api/` folder, `vercel.json` | Vercel ke liye (har file `lib/app.js` ko chalati hai) |
| `lib/store.js` | Posts kahaan save hon (Redis ya file) |
| `lib/extract.js` | Page se dates / fees / links nikalta hai |
| `public/index.html` | Aapki website (ticker + section judne ke baad) |
| `public/assets/updates.js`, `updates.css` | Ticker, boxes aur popup |
| `public/admin/index.html` | Admin panel |
| `data/posts.json` | Computer par chalane par posts yahan save hoti hain |
