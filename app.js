/* ══════════════════════════════════════════════════════════
   PORTAL SISCTE — app.js  v3.0
   ─ Estrategia dual de almacenamiento:
     • Archivos ≤ 800 KB originales  → comprimidos con pako
       (gzip) y guardados en Firestore como base64 (~60% menos)
     • Archivos > 800 KB originales  → Firebase Storage
       (requiere CORS configurado en tu bucket)
   ─ CORS fix documentado abajo
   ─ EmailJS para correo de confirmación al usuario
   ─ Panel admin con filtros y exportación Excel filtrada
══════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════
   SOLUCIÓN AL ERROR CORS EN GITHUB PAGES
   ──────────────────────────────────────────────────────────
   Si ves "Access blocked by CORS policy" en Firebase Storage,
   ejecuta ESTOS PASOS UNA SOLA VEZ desde tu PC:

   1. Instala Google Cloud SDK: https://cloud.google.com/sdk/docs/install
   2. Crea un archivo cors.json con este contenido exacto:
      [{"origin":["https://kattyeliza2000.github.io","http://localhost"],
        "method":["GET","POST","PUT","DELETE","HEAD"],
        "maxAgeSeconds":3600}]
   3. Ejecuta en terminal:
      gcloud auth login
      gsutil cors set cors.json gs://siscte2-e38de.firebasestorage.app
   4. Verifica con:
      gsutil cors get gs://siscte2-e38de.firebasestorage.app

   MIENTRAS TANTO: el sistema usa Firestore comprimido
   automáticamente para archivos hasta 800 KB.
   Para archivos más grandes: arregla CORS primero.
══════════════════════════════════════════════════════════ */

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBF2Ivt-OGqNPpxMEUNt_f4Jd6uBpOhq2Y",
  authDomain:        "siscte2-e38de.firebaseapp.com",
  projectId:         "siscte2-e38de",
  storageBucket:     "siscte2-e38de.firebasestorage.app",
  messagingSenderId: "234056629895",
  appId:             "1:234056629895:web:a7f6953ccc7957a7398222"
};

/* ── EMAILJS ─────────────────────────────────────────────
   1. Regístrate en https://www.emailjs.com (gratis 200/mes)
   2. Crea un Service Gmail → copia Service ID
   3. Crea un Template con: {{to_email}}, {{to_name}},
      {{area}}, {{archivo}}, {{fecha}}, {{hora}}, {{tamano}}
   4. Account → API Keys → Public Key
──────────────────────────────────────────────────────── */
const EMAILJS_CONFIG = {
  publicKey:  "gaScEoguCEcx7aFYT",
  serviceId:  "service_ybvnh3i",
  templateId: "template_8d6u82j"
};

/* Archivos menores a este umbral van a Firestore comprimido */
const UMBRAL_BYTES = 800 * 1024;

const ADMIN_EMAILS = [
  "parametrosp.cte@gmail.com",

];

const AREAS = [
  "ZONA 5","ZONA 6",
  "CEBAF TULCAN","CEBAF NUEVA LOJA","CEBAF HUAQUILLAS",
  "CEBAF MACARA","CEBAF AREA COMPUTO NACIONAL",
  "PROV_PICHINCHA","PROV_MANABI","PROV_SANTO DOMINGO",
  "PROV_LOS RIOS","PROV_BOLIVAR","PROV_SANTA ELENA",
  "PROV_AZUAY","PROV_EL ORO",
  "UREM","OIAT","EDU_VIAL","CRV","ECU-911"
];

let db, auth, storage, usuario = null;
let archivoSeleccionado = null;
let docsAdmin = [];
let pakoListo = false;

/* ══════════════════════════════════
   FIREBASE INIT
══════════════════════════════════ */
async function initFirebase() {
  const { initializeApp }
    = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
  const { getFirestore, collection, addDoc, getDocs, orderBy, query, doc, getDoc }
    = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
  const { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
    createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, updateProfile }
    = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
  const { getStorage, ref, uploadBytesResumable, getDownloadURL }
    = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js");

  const app = initializeApp(FIREBASE_CONFIG);
  db = getFirestore(app);
  auth = getAuth(app);
  storage = getStorage(app);

  window._fb = {
    collection, addDoc, getDocs, orderBy, query, doc, getDoc,
    GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
    createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, updateProfile,
    ref, uploadBytesResumable, getDownloadURL
  };

  cargarPako();

  onAuthStateChanged(auth, u => {
    if (u) {
      usuario = { uid: u.uid, nombre: u.displayName, email: u.email, foto: u.photoURL };
      actualizarNav();
      esAdmin() ? show('nb-subir') : hide('nb-subir');
      esAdmin() ? show('nb-subir') : hide('nb-subir');
    esAdmin() ? show('nb-admin') : hide('nb-admin');
      irSubir();
    } else {
      usuario = null;
      actualizarNav();
      ir('vista-login');
    }
  });
}

async function cargarPako() {
  if (window.pako) { pakoListo = true; return; }
  try {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    pakoListo = true;
  } catch(e) { console.warn('pako no disponible'); }
}

/* ══════════════════════════════════
   AUTH
══════════════════════════════════ */
async function login() {
  try {
    const provider = new window._fb.GoogleAuthProvider();
    await window._fb.signInWithPopup(auth, provider);
  } catch(e) { toast('Error al iniciar sesión: ' + e.message, 'err'); }
}

async function logout() {
  try { await window._fb.signOut(auth); } catch(e) {}
}

async function loginEmail() {
  const email = document.getElementById('login-email')?.value?.trim();
  const pass  = document.getElementById('login-pass')?.value;
  if (!email || !pass) { toast('Ingresa correo y contraseña','err'); return; }
  try {
    const cred = await window._fb.signInWithEmailAndPassword(auth, email, pass);
    await cred.user.reload();
  } catch(e) {
    const msg = e.code === 'auth/invalid-credential' ? 'Correo o contraseña incorrectos'
              : e.code === 'auth/user-not-found'     ? 'No existe una cuenta con ese correo'
              : e.code === 'auth/wrong-password'     ? 'Contraseña incorrecta'
              : 'Error: ' + e.message;
    toast(msg, 'err');
  }
}

async function registrarEmail() {
  const nombre = document.getElementById('reg-nombre')?.value?.trim();
  const email  = document.getElementById('reg-email')?.value?.trim();
  const pass   = document.getElementById('reg-pass')?.value;
  if (!nombre) { toast('Ingresa tu nombre completo','err'); return; }
  if (!email)  { toast('Ingresa tu correo','err'); return; }
  if (!pass || pass.length < 6) { toast('La contraseña debe tener al menos 6 caracteres','err'); return; }
  try {
    const cred = await window._fb.createUserWithEmailAndPassword(auth, email, pass);
    await window._fb.updateProfile(cred.user, { displayName: nombre });
    await cred.user.reload();
    // Trigger auth state refresh manually
    usuario = { uid: cred.user.uid, nombre: nombre, email: cred.user.email, foto: cred.user.photoURL };
    actualizarNav();
    toast('Cuenta creada exitosamente ✓');
  } catch(e) {
    const msg = e.code === 'auth/email-already-in-use' ? 'Ya existe una cuenta con ese correo'
              : e.code === 'auth/invalid-email'        ? 'Correo no válido'
              : e.code === 'auth/weak-password'        ? 'La contraseña es muy débil'
              : 'Error: ' + e.message;
    toast(msg, 'err');
  }
}

async function olvidoContrasena() {
  const email = document.getElementById('login-email')?.value?.trim();
  if (!email) { toast('Ingresa primero tu correo en el campo de arriba','err'); return; }
  try {
    await window._fb.sendPasswordResetEmail(auth, email);
    toast('Correo de recuperación enviado — revisa tu bandeja ✓');
  } catch(e) {
    toast('No se encontró una cuenta con ese correo','err');
  }
}

window.switchTab = function(tab) {
  document.getElementById('panel-login').style.display    = tab==='login'    ? 'block' : 'none';
  document.getElementById('panel-registro').style.display = tab==='registro' ? 'block' : 'none';
  document.getElementById('tab-login').classList.toggle('active',    tab==='login');
  document.getElementById('tab-registro').classList.toggle('active', tab==='registro');
};

const esAdmin = () =>
  usuario && ADMIN_EMAILS.map(x => x.toLowerCase()).includes(usuario.email.toLowerCase());

/* ══════════════════════════════════
   DOM HELPERS
══════════════════════════════════ */
const $       = id => document.getElementById(id);
const show    = id => { const e=$(id); if(e) e.style.display='block'; };
const hide    = id => { const e=$(id); if(e) e.style.display='none'; };
const hideAll = () => ['vista-login','vista-subir','vista-exito','vista-admin'].forEach(hide);

function ir(v) {
  hideAll(); 
  // vista-login necesita flex para centrado, las demás usan block
  const el = $(v);
  if (!el) return;
  el.style.display = (v === 'vista-login') ? 'flex' : 'block';
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if (v==='vista-subir'||v==='vista-exito') $('nb-subir')?.classList.add('active');
  if (v==='vista-admin') $('nb-admin')?.classList.add('active');
}

function toast(msg, tipo='ok') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast toast--${tipo} toast--on`;
  clearTimeout(t._t);
  t._t = setTimeout(() => t.className = 'toast', 4200);
}

function actualizarNav() {
  if (usuario) {
    const fotoEl = $('nav-foto');
    if (usuario.foto) {
      fotoEl.src = usuario.foto;
      fotoEl.style.display = 'block';
      const initEl = $('nav-iniciales');
      if (initEl) initEl.style.display = 'none';
    } else {
      fotoEl.style.display = 'none';
      let initEl = $('nav-iniciales');
      if (!initEl) {
        initEl = document.createElement('div');
        initEl.id = 'nav-iniciales';
        initEl.style.cssText = 'width:26px;height:26px;border-radius:50%;background:var(--blue);color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
        fotoEl.parentNode.insertBefore(initEl, fotoEl.nextSibling);
      }
      const nombre = usuario.nombre || usuario.email || '?';
      const partes = nombre.trim().split(' ');
      initEl.textContent = partes.length >= 2
        ? (partes[0][0] + partes[1][0]).toUpperCase()
        : nombre.slice(0,2).toUpperCase();
      initEl.style.display = 'flex';
    }
    $('nav-nombre').textContent = usuario.nombre?.split(' ')[0] || usuario.email;
    show('nav-sesion'); hide('nav-guest');
    esAdmin() ? show('nb-subir') : hide('nb-subir');
    esAdmin() ? show('nb-admin') : hide('nb-admin');
  } else {
    hide('nav-sesion'); show('nav-guest'); hide('nb-admin');
  }
}

function resetBtn() {
  const btn = $('btn-enviar');
  if (!btn) return;
  btn.disabled = false;
  btn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
    </svg> Registrar Envío`;
}

/* ══════════════════════════════════
   AREAS
══════════════════════════════════ */
function poblarAreas(selectId, placeholder='— Selecciona tu área —') {
  const sel = $(selectId);
  if (!sel) return;
  sel.innerHTML = `<option value="">${placeholder}</option>`;
  AREAS.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a; opt.textContent = a;
    sel.appendChild(opt);
  });
}

/* ══════════════════════════════════
   VISTA SUBIR
══════════════════════════════════ */
function irSubir() {
  archivoSeleccionado = null;
  $('dropzone').style.display = 'flex';
  $('file-preview').style.display = 'none';
  $('progress-wrap').style.display = 'none';
  $('area-select').value = '';
  const det = $('detalle-envio'); if (det) det.value = '';
  resetBtn();
  const heroNombre = $('hero-nombre');
  if (heroNombre) heroNombre.textContent = usuario.nombre || usuario.email;
  ir('vista-subir');
  cargarMisEnvios();
}

/* ══════════════════════════════════
   MIS ENVÍOS — historial personal
══════════════════════════════════ */
async function cargarMisEnvios() {
  const lista = $('mis-envios-lista');
  if (!lista || !usuario) return;
  lista.innerHTML = `<div class="mis-envios-vacio"><p style="font-size:12px;color:var(--txt3);">Cargando tus envíos...</p></div>`;
  try {
    const { where } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const q = window._fb.query(
      window._fb.collection(db,'entregas'),
      where('uid','==',usuario.uid)
    );
    const snap = await window._fb.getDocs(q);
    const docs = snap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||''));
    if (docs.length === 0) {
      lista.innerHTML = `
        <div class="mis-envios-vacio">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
          <p>No hay envíos registrados todavía.</p>
        </div>`;
      return;
    }
    lista.innerHTML = docs.map(d=>`
      <div class="mis-envio-item${d.archivado?' mei-archivado':''}">
        <div class="mei-ico">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div class="mei-info">
          <div class="mei-nombre">${d.nombreArchivo}</div>
          <div class="mei-meta">
            <span class="mei-area">${d.area||'—'}</span>
            &nbsp;·&nbsp;${d.fechaTexto} · ${d.horaTexto}
            &nbsp;·&nbsp;${d.tamanoTexto||'—'}
            ${d.archivado?'&nbsp;·&nbsp;<span style="color:var(--txt3);font-size:10px;font-weight:600;">Archivado</span>':''}
          </div>
        </div>
      </div>`).join('');
  } catch(e) {
    lista.innerHTML = `<div class="mis-envios-vacio"><p style="color:var(--red);font-size:11px;">Error: ${e.message}</p></div>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initFirebase();
  poblarAreas('area-select');
  poblarAreas('filtro-area', 'Todas las áreas');

  $('btn-google').addEventListener('click', login);
  document.getElementById('btn-login-email')?.addEventListener('click', loginEmail);
  document.getElementById('btn-registrar')?.addEventListener('click', registrarEmail);
  document.getElementById('btn-forgot')?.addEventListener('click', olvidoContrasena);
  document.querySelectorAll('.btn-logout').forEach(b => b.addEventListener('click', logout));
  $('nb-subir').addEventListener('click', () => usuario ? irSubir() : ir('vista-login'));
  $('nb-admin').addEventListener('click', () => { if(esAdmin()){ ir('vista-admin'); cargarAdmin(); } });
  $('btn-enviar-otro').addEventListener('click', irSubir);

  const dz = $('dropzone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dz-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dz-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('dz-over');
    if (e.dataTransfer.files[0]) seleccionar(e.dataTransfer.files[0]);
  });
  dz.addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', () => {
    if ($('file-input').files[0]) seleccionar($('file-input').files[0]);
  });
  $('btn-cambiar').addEventListener('click', () => {
    archivoSeleccionado = null;
    $('file-preview').style.display = 'none';
    $('dropzone').style.display = 'flex';
  });
  $('btn-enviar').addEventListener('click', enviarArchivo);
  $('btn-filtrar').addEventListener('click', aplicarFiltros);
  $('btn-limpiar').addEventListener('click', limpiarFiltros);
  $('btn-excel').addEventListener('click', () => exportarExcel(docsAdmin, false));
  $('btn-excel-filtrado').addEventListener('click', exportarFiltrado);
});

/* ── VALIDACIÓN ── */
function seleccionar(f) {
  const ext = f.name.split('.').pop().toLowerCase();
  if (!['xlsx','xls'].includes(ext)) {
    toast('Solo se aceptan archivos Excel (.xlsx o .xls)', 'err'); return;
  }
  archivoSeleccionado = f;
  $('fp-nombre').textContent = f.name;
  $('fp-peso').textContent   = formatSize(f.size);
  const modo = f.size <= UMBRAL_BYTES
    ? '⚡ Se guardará comprimido (sin CORS)'
    : '☁️ Firebase Storage (CORS requerido)';
  const modoEl = $('fp-modo');
  if (modoEl) modoEl.textContent = modo;
  $('dropzone').style.display     = 'none';
  $('file-preview').style.display = 'flex';
}

function formatSize(bytes) {
  if (bytes >= 1024*1024) return (bytes/(1024*1024)).toFixed(2)+' MB';
  return (bytes/1024).toFixed(1)+' KB';
}

function fileToArrayBuffer(file) {
  return new Promise((res,rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result);
    r.onerror = rej;
    r.readAsArrayBuffer(file);
  });
}

function arrayBufferToBase64(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer);
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode(...bytes.subarray(i, i+chunk));
  return btoa(binary);
}

function setProgreso(pct, label) {
  $('progress-bar').style.width = pct+'%';
  $('progress-txt').textContent = pct+'%';
  const lbl = $('progress-label-txt');
  if (lbl) lbl.textContent = label||'';
}

/* ══════════════════════════════════
   ENVIAR ARCHIVO — ESTRATEGIA DUAL
══════════════════════════════════ */
async function enviarArchivo() {
  if (!archivoSeleccionado){ toast('Selecciona un archivo primero','err'); return; }
  const areaVal = $('area-select').value;
  if (!areaVal){ toast('Debes seleccionar tu área antes de enviar','err'); return; }
  const detalleVal = ($('detalle-envio')?.value||'').trim();

  const btn = $('btn-enviar');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Subiendo...';
  $('progress-wrap').style.display = 'block';
  setProgreso(5, 'Preparando...');

  try {
    const ahora      = new Date();
    const fechaTexto = ahora.toLocaleDateString('es-EC',{timeZone:'America/Guayaquil',day:'2-digit',month:'long',year:'numeric'});
    const horaTexto  = ahora.toLocaleTimeString('es-EC',{timeZone:'America/Guayaquil',hour:'2-digit',minute:'2-digit',second:'2-digit'});

    let metodo, storageURL=null, archivoBase64=null, tamComp=null;

    /* ─ Firestore comprimido para archivos pequeños ─ */
    if (archivoSeleccionado.size <= UMBRAL_BYTES) {
      metodo = 'firestore_comprimido';
      setProgreso(20,'Leyendo archivo...');
      const buffer = await fileToArrayBuffer(archivoSeleccionado);
      setProgreso(40,'Comprimiendo con gzip...');

      if (!pakoListo) await cargarPako();
      if (window.pako) {
        const comp = window.pako.gzip(new Uint8Array(buffer));
        archivoBase64 = arrayBufferToBase64(comp);
        tamComp = formatSize(comp.length);
        setProgreso(65,`Comprimido → ${tamComp}`);
      } else {
        archivoBase64 = arrayBufferToBase64(buffer);
        setProgreso(65,'Listo para guardar...');
      }

    /* ─ Firebase Storage para archivos grandes ─ */
    } else {
      metodo = 'firebase_storage';
      const path = `entregas/${usuario.uid}/${ahora.getTime()}_${archivoSeleccionado.name}`;
      const task = window._fb.uploadBytesResumable(window._fb.ref(storage, path), archivoSeleccionado);

      storageURL = await new Promise((resolve, reject) => {
        task.on('state_changed',
          snap => {
            const p = Math.round(10 + (snap.bytesTransferred/snap.totalBytes)*60);
            setProgreso(p, `Subiendo... ${p}%`);
          },
          err => {
            // Si es CORS, intentar con Firestore comprimido si el archivo cabe
            if ((err.message||'').toLowerCase().includes('cors') || err.code==='storage/unknown') {
              reject(new Error('CORS_ERROR'));
            } else {
              reject(err);
            }
          },
          async () => {
            resolve(await window._fb.getDownloadURL(task.snapshot.ref));
          }
        );
      });
    }

    setProgreso(80,'Registrando en Firestore...');

    await window._fb.addDoc(window._fb.collection(db,'entregas'),{
      uid:              usuario.uid,
      nombre:           usuario.nombre,
      email:            usuario.email,
      foto:             usuario.foto,
      area:             areaVal,
      nombreArchivo:    archivoSeleccionado.name,
      tamanoBytes:      archivoSeleccionado.size,
      tamanoTexto:      formatSize(archivoSeleccionado.size),
      tamanoComprimido: tamComp,
      metodo,
      storageURL,
      archivoBase64,
      comprimido:       (metodo==='firestore_comprimido' && !!window.pako),
      mimeType:         archivoSeleccionado.type||'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      detalle:          detalleVal,
      fechaTexto,
      horaTexto,
      timestamp:        ahora.toISOString()
    });

    setProgreso(100,'¡Completado!');
    mostrarExito(areaVal, fechaTexto, horaTexto);
    enviarCorreoNotificacion({
      nombre:  usuario.nombre, email: usuario.email,
      area:    areaVal, archivo: archivoSeleccionado.name,
      tamano:  formatSize(archivoSeleccionado.size),
      fecha:   fechaTexto, hora: horaTexto
    });
    setTimeout(() => ir('vista-exito'), 500);

  } catch(err) {
    console.error(err);
    if (err.message==='CORS_ERROR') {
      toast('Error CORS en Storage. Solo disponible para archivos ≤ 800 KB por ahora.','err');
      toast('Configura CORS en Firebase según las instrucciones del README.','err');
    } else {
      toast('Error al subir: '+err.message,'err');
    }
    $('progress-wrap').style.display='none';
    resetBtn();
  }
}

function mostrarExito(area, fecha, hora) {
  $('ex-nombre').textContent  = usuario.nombre;
  $('ex-email').textContent   = usuario.email;
  $('ex-area').textContent    = area;
  $('ex-archivo').textContent = archivoSeleccionado.name;
  $('ex-tamano').textContent  = formatSize(archivoSeleccionado.size);
  $('ex-fecha').textContent   = fecha;
  $('ex-hora').textContent    = hora;
}

/* ══════════════════════════════════
   EMAILJS
══════════════════════════════════ */
async function enviarCorreoNotificacion(datos) {
  try {
    if (!window.emailjs) {
      await new Promise((res,rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
        s.onload=res; s.onerror=rej;
        document.head.appendChild(s);
      });
      emailjs.init(EMAILJS_CONFIG.publicKey);
    }
    await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId,{
      to_email: datos.email, to_name: datos.nombre,
      area: datos.area, archivo: datos.archivo,
      tamano: datos.tamano, fecha: datos.fecha, hora: datos.hora
    });
    toast('Correo de confirmación enviado ✓');
  } catch(e) {
    console.warn('EmailJS:', e.message||e);
  }
}

/* ══════════════════════════════════
   PANEL ADMIN
══════════════════════════════════ */
async function cargarAdmin() {
  $('tabla-body').innerHTML     = `<tr><td colspan="7" class="td-vacio">Cargando...</td></tr>`;
  $('admin-personas').innerHTML = `<p class="cargando-txt">Cargando...</p>`;

  try {
    const q    = window._fb.query(window._fb.collection(db,'entregas'), window._fb.orderBy('timestamp','desc'));
    const snap = await window._fb.getDocs(q);
    docsAdmin  = snap.docs.map(d => ({id:d.id,...d.data()}));
    renderAdmin(docsAdmin);
  } catch(e) {
    console.error(e);
    toast('Error al cargar: '+e.message,'err');
  }
}

function renderAdmin(docs) {
  const unicos = [...new Set(docs.map(d=>d.email))];
  $('st-total').textContent  = docs.length;
  $('st-unicos').textContent = unicos.length;
  $('st-ultimo').textContent = docs.length ? `${docs[0].fechaTexto} · ${docs[0].horaTexto}` : 'Sin entregas aún';

  /* Personas */
  const porPersona = {};
  docs.forEach(d => {
    if (!porPersona[d.email]) porPersona[d.email]={...d,cant:0,areas:new Set()};
    porPersona[d.email].cant++;
    if(d.area) porPersona[d.email].areas.add(d.area);
  });
  $('admin-personas').innerHTML = Object.values(porPersona)
    .sort((a,b)=>b.cant-a.cant)
    .map(p=>`
      <div class="persona-row">
        <img class="persona-foto" src="${p.foto||avatar(p.nombre)}" alt="" onerror="this.src='${avatar(p.nombre)}'">
        <div class="persona-info">
          <div class="persona-nombre">${p.nombre||'—'}</div>
          <div class="persona-email">${p.email}</div>
          <div class="persona-ultima">Área(s): ${[...p.areas].join(', ')||'—'} · Último: ${p.fechaTexto} · ${p.horaTexto}</div>
        </div>
        <span class="persona-badge">${p.cant} archivo${p.cant>1?'s':''}</span>
      </div>`).join('') || '<p class="cargando-txt">Sin entregas</p>';

  /* Tabla */
  $('tabla-body').innerHTML = docs.length===0
    ? `<tr><td colspan="9" class="td-vacio">No hay registros para los filtros aplicados</td></tr>`
    : docs.map((d,i)=>`
        <tr class="${d.archivado?'tr-archivado':''}">
          <td class="td-n">${i+1}</td>
          <td><div class="td-user">
            <img class="td-foto" src="${d.foto||avatar(d.nombre)}" alt="" onerror="this.src='${avatar(d.nombre)}'">
            <div><div class="td-nombre">${d.nombre||'—'}</div><div class="td-email">${d.email}</div></div>
          </div></td>
          <td><span class="badge-area">${d.area||'—'}</span></td>
          <td class="td-arch">${renderDescarga(d)}</td>
          <td class="td-detalle" title="${d.detalle||'—'}">${d.detalle ? (d.detalle.length>40 ? d.detalle.slice(0,40)+'…' : d.detalle) : '<span style="color:#9ca3af">—</span>'}</td>
          <td class="td-peso">${d.tamanoTexto||'—'}${d.tamanoComprimido?`<div class="td-comprimido">gzip: ${d.tamanoComprimido}</div>`:''}</td>
          <td class="td-fecha">${d.fechaTexto}</td>
          <td class="td-hora">${d.horaTexto}</td>
          <td>${d.archivado
            ? `<span class="badge-archivado">Archivado</span>`
            : `<span class="badge-activo">Activo</span>`}</td>
        </tr>`).join('');

  $('filtro-resultado').textContent=`${docs.length} registro${docs.length!==1?'s':''} encontrado${docs.length!==1?'s':''}`;
}

function renderDescarga(d) {
  const svg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
  if (d.storageURL)
    return `<a href="${d.storageURL}" target="_blank" download="${d.nombreArchivo}" class="link-archivo">${svg}${d.nombreArchivo}</a>`;
  if (d.archivoBase64)
    return `<button onclick="descargarFirestore('${d.id}')" class="link-archivo" style="background:none;border:none;cursor:pointer;padding:0;font-family:inherit;">${svg}${d.nombreArchivo}</button>`;
  return `<span style="color:var(--txt3);font-size:12px;">${d.nombreArchivo||'—'}</span>`;
}

window.descargarFirestore = async function(docId) {
  try {
    toast('Preparando descarga...','ok');
    if (!pakoListo) await cargarPako();
    const snap = await window._fb.getDoc(window._fb.doc(db,'entregas',docId));
    if (!snap.exists()){ toast('Archivo no encontrado','err'); return; }
    const d = snap.data();
    const binary = atob(d.archivoBase64);
    const bytes  = new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
    const datos = (d.comprimido && window.pako) ? window.pako.ungzip(bytes) : bytes;
    const blob  = new Blob([datos],{type:d.mimeType});
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href=url; a.download=d.nombreArchivo; a.click();
    URL.revokeObjectURL(url);
    toast('Descarga iniciada ✓');
  } catch(e){ toast('Error al descargar: '+e.message,'err'); }
};

/* ══════════════════════════════════
   FILTROS
══════════════════════════════════ */
function filtrarDocs(docs) {
  const area   = $('filtro-area').value.toLowerCase();
  const nombre = $('filtro-nombre').value.trim().toLowerCase();
  const email  = $('filtro-email').value.trim().toLowerCase();
  const fechaD = $('filtro-fecha-desde').value;
  const fechaH = $('filtro-fecha-hasta').value;
  let r = [...docs];
  if (area)   r=r.filter(d=>(d.area||'').toLowerCase().includes(area));
  if (nombre) r=r.filter(d=>(d.nombre||'').toLowerCase().includes(nombre));
  if (email)  r=r.filter(d=>(d.email||'').toLowerCase().includes(email));
  if (fechaD) r=r.filter(d=>d.timestamp>=new Date(fechaD).toISOString());
  if (fechaH){ const h=new Date(fechaH); h.setHours(23,59,59); r=r.filter(d=>d.timestamp<=h.toISOString()); }
  return r;
}

function aplicarFiltros(){ renderAdmin(filtrarDocs(docsAdmin)); }

function limpiarFiltros(){
  ['filtro-area','filtro-nombre','filtro-email','filtro-fecha-desde','filtro-fecha-hasta']
    .forEach(id=>{ const e=$(id); if(e) e.value=''; });
  renderAdmin(docsAdmin);
}

function exportarFiltrado(){ exportarExcel(filtrarDocs(docsAdmin),true); }

/* ══════════════════════════════════
   EXPORTAR EXCEL
══════════════════════════════════ */
const avatar = n =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(n||'?')}&background=1d4ed8&color=fff`;

async function exportarExcel(docs, filtrado=false){
  if (!window.XLSX){
    await new Promise((res,rej)=>{
      const s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload=res; s.onerror=rej; document.head.appendChild(s);
    });
  }
  const filas = docs.map((d,i)=>({
    '#':i+1,
    'Nombre':d.nombre||'—',
    'Correo':d.email||'—',
    'Área':d.area||'—',
    'Archivo':d.nombreArchivo||'—',
    'Descripción':d.detalle||'—',
    'Peso':d.tamanoTexto||'—',
    'Fecha':d.fechaTexto||'—',
    'Hora':d.horaTexto||'—',
    'Estado':d.archivado?'ARCHIVADO':'Activo'
  }));
  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.json_to_sheet(filas);
  ws['!cols']=[{wch:4},{wch:28},{wch:34},{wch:22},{wch:38},{wch:40},{wch:12},{wch:22},{wch:14},{wch:12}];
  XLSX.utils.book_append_sheet(wb,ws,'Entregas');
  XLSX.writeFile(wb,`informe_SISCTE${filtrado?'_filtrado':'_completo'}_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast(`Informe${filtrado?' filtrado':''} descargado ✓`);
}

/* ══════════════════════════════════════════════════════
   SISTEMA DE ARCHIVADO MENSUAL
   ─ Descarga todos los archivos del mes seleccionado
   ─ Pregunta confirmación antes de liberar binarios
   ─ Conserva el historial (metadatos) para siempre
   ─ Marca los registros como archivados en Firestore
══════════════════════════════════════════════════════ */

/* ── Habilitar botón de descarga solo si los 3 checks están marcados ── */
window.verificarChecks = function() {
  const ok = $('check1')?.checked && $('check2')?.checked && $('check3')?.checked;
  const btn = $('arch-btn-descargar');
  if (btn) btn.disabled = !ok;
};

/* ── Abre el modal de archivado ── */
function abrirModalArchivado() {
  // Construir lista de meses disponibles con archivos NO archivados
  const mesesMap = {};
  docsAdmin.forEach(d => {
    if (d.archivado) return; // ya archivados no se muestran
    if (!d.archivoBase64 && !d.storageURL) return; // sin binario tampoco
    const mes = d.timestamp.slice(0,7); // "2025-06"
    if (!mesesMap[mes]) mesesMap[mes] = { docs:[], label: labelMes(d.timestamp) };
    mesesMap[mes].docs.push(d);
  });

  const meses = Object.entries(mesesMap).sort((a,b)=>b[0].localeCompare(a[0]));

  if (meses.length === 0) {
    toast('No hay archivos pendientes de archivar','ok');
    return;
  }

  // Poblar select de meses en el modal
  const sel = $('arch-mes-select');
  sel.innerHTML = '<option value="">— Selecciona el mes —</option>';
  meses.forEach(([key, val]) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = `${val.label} (${val.docs.length} archivo${val.docs.length>1?'s':''})`;
    sel.appendChild(opt);
  });

  // Guardar meses en memoria para usarlos al confirmar
  window._archMeses = mesesMap;

  $('modal-archivado').style.display = 'flex';
  $('arch-paso1').style.display = 'block';
  $('arch-paso2').style.display = 'none';
  $('arch-paso3').style.display = 'none';
  $('arch-btn-siguiente').disabled = true;
}

/* ── Label legible del mes ── */
function labelMes(isoTimestamp) {
  const d = new Date(isoTimestamp);
  return d.toLocaleDateString('es-EC', { month:'long', year:'numeric', timeZone:'America/Guayaquil' });
}

/* ── El admin seleccionó un mes: mostrar resumen ── */
function seleccionarMesArchivado() {
  const mes = $('arch-mes-select').value;
  $('arch-btn-siguiente').disabled = !mes;
  if (!mes) return;
  const info = window._archMeses[mes];
  $('arch-resumen').innerHTML = `
    <div class="arch-stat"><span>${info.docs.length}</span> archivos a descargar y archivar</div>
    <div class="arch-personas">
      ${info.docs.map(d=>`
        <div class="arch-persona-row">
          <img src="${d.foto||avatar(d.nombre)}" alt="" onerror="this.src='${avatar(d.nombre)}'">
          <div>
            <div class="arch-persona-nombre">${d.nombre||'—'} <span class="badge-area" style="font-size:10px">${d.area||''}</span></div>
            <div class="arch-persona-archivo">${d.nombreArchivo} · ${d.tamanoTexto||'—'}</div>
          </div>
        </div>`).join('')}
    </div>`;
}

/* ── Avanzar a paso 2 (advertencia) ── */
function archPaso2() {
  const mes = $('arch-mes-select').value;
  if (!mes) return;
  $('arch-paso1').style.display = 'none';
  $('arch-paso2').style.display = 'block';
  const info = window._archMeses[mes];
  $('arch-advertencia-detalle').textContent =
    `Se descargarán ${info.docs.length} archivo(s) de ${labelMes(info.docs[0].timestamp)}. ` +
    `Después podrás eliminar los binarios de la base de datos. El historial de envíos quedará guardado permanentemente.`;
}

/* ── PASO 3: Descargar todos los archivos del mes ── */
async function descargarMesCompleto() {
  const mes  = $('arch-mes-select').value;
  const info = window._archMeses[mes];
  if (!pakoListo) await cargarPako();

  $('arch-paso2').style.display = 'none';
  $('arch-paso3').style.display = 'block';
  $('arch-progreso-txt').textContent = 'Descargando archivos...';

  let ok = 0;
  for (let i=0; i<info.docs.length; i++) {
    const d = info.docs[i];
    $('arch-progreso-bar').style.width = Math.round(((i+1)/info.docs.length)*100)+'%';
    $('arch-progreso-txt').textContent = `Descargando ${i+1} de ${info.docs.length}: ${d.nombreArchivo}`;
    try {
      await descargarArchivoLocal(d);
      ok++;
    } catch(e) {
      console.warn('Error descargando', d.nombreArchivo, e);
    }
    // Pequeña pausa para no saturar el navegador
    await new Promise(r => setTimeout(r, 300));
  }

  $('arch-progreso-txt').textContent = `✓ ${ok} de ${info.docs.length} archivos descargados`;
  $('arch-btn-archivar').style.display = 'block';
  $('arch-btn-archivar').onclick = () => confirmarArchivar(mes, info.docs);
}

/* ── Descarga un archivo individual al disco local ── */
async function descargarArchivoLocal(d) {
  if (d.archivoBase64) {
    const binary = atob(d.archivoBase64);
    const bytes  = new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
    const datos = (d.comprimido && window.pako) ? window.pako.ungzip(bytes) : bytes;
    const blob  = new Blob([datos],{type:d.mimeType});
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href=url; a.download=d.nombreArchivo; a.click();
    URL.revokeObjectURL(url);
  } else if (d.storageURL) {
    // Para Storage: abrir en nueva pestaña (el navegador descargará)
    window.open(d.storageURL, '_blank');
  }
}

/* ── CONFIRMAR ARCHIVADO: Borrar binarios, conservar metadatos ── */
async function confirmarArchivar(mes, docs) {
  $('arch-btn-archivar').disabled = true;
  $('arch-btn-archivar').textContent = 'Archivando...';
  $('arch-progreso-txt').textContent = 'Eliminando binarios de Firestore...';

  try {
    const { doc, updateDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");

    let procesados = 0;
    for (const d of docs) {
      $('arch-progreso-bar').style.width = Math.round(((procesados+1)/docs.length)*100)+'%';
      // Eliminar solo el binario, conservar todos los demás campos
      await updateDoc(doc(db,'entregas',d.id), {
        archivoBase64: null,
        storageURL:    null,
        archivado:     true,
        fechaArchivado: new Date().toISOString(),
        notaArchivado: `Archivado manualmente el ${new Date().toLocaleDateString('es-EC',{timeZone:'America/Guayaquil',day:'2-digit',month:'long',year:'numeric'})}`
      });
      procesados++;
      await new Promise(r => setTimeout(r, 150));
    }

    $('arch-progreso-txt').textContent = `✓ ${procesados} registros archivados. Historial conservado.`;
    $('arch-btn-archivar').textContent = '✓ Archivado completado';

    // Recargar la lista del admin
    setTimeout(async () => {
      cerrarModalArchivado();
      await cargarAdmin();
      toast(`Mes ${labelMes(docs[0].timestamp)} archivado correctamente ✓`);
    }, 2000);

  } catch(e) {
    toast('Error al archivar: '+e.message,'err');
    $('arch-btn-archivar').disabled = false;
    $('arch-btn-archivar').textContent = 'Reintentar archivado';
  }
}

function cerrarModalArchivado() {
  $('modal-archivado').style.display = 'none';
}

/* ── Exponer funciones al HTML inline ── */
window.abrirModalArchivado    = abrirModalArchivado;
window.irSubir                = irSubir;
window.cerrarModalArchivado   = cerrarModalArchivado;
window.seleccionarMesArchivado = seleccionarMesArchivado;
window.archPaso2              = archPaso2;
window.descargarMesCompleto   = descargarMesCompleto;
