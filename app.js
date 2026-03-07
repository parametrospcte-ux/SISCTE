/* ══════════════════════════════════════════════════════════
   PORTAL SISCTE — app.js  v4.0
   ─ Estrategia de almacenamiento:
     • Archivos ≤ 800 KB  → Firestore comprimido (pako/gzip)
     • Archivos > 800 KB  → Google Drive del usuario (gratis, hasta 15 GB)
   ─ Google Drive API para archivos grandes (100% gratuito)
   ─ EmailJS para correo de confirmación al usuario
   ─ Panel admin con filtros y exportación Excel filtrada
══════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════
   PASOS PARA ACTIVAR GOOGLE DRIVE API (una sola vez)
   ──────────────────────────────────────────────────────────
   1. Ve a: https://console.cloud.google.com
   2. Selecciona el proyecto siscte2-e38de
   3. APIs y Servicios → Biblioteca → "Google Drive API" → Activar
   4. APIs y Servicios → Credenciales → Crear credencial
      → ID de cliente OAuth 2.0 → Aplicación web
      → Orígenes JS autorizados: https://TU-DOMINIO.github.io
   5. Copia el Client ID y pégalo abajo en GDRIVE_CLIENT_ID
   6. Pantalla de consentimiento OAuth → Agregar scope:
      https://www.googleapis.com/auth/drive.file
══════════════════════════════════════════════════════════ */

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBF2Ivt-OGqNPpxMEUNt_f4Jd6uBpOhq2Y",
  authDomain:        "siscte2-e38de.firebaseapp.com",
  projectId:         "siscte2-e38de",
  storageBucket:     "siscte2-e38de.firebasestorage.app",
  messagingSenderId: "234056629895",
  appId:             "1:234056629895:web:a7f6953ccc7957a7398222"
};

/* ── GOOGLE DRIVE ────────────────────────────────────────
   Reemplaza con tu Client ID de Google Cloud Console
──────────────────────────────────────────────────────── */
const GDRIVE_CLIENT_ID = "234056629895-0d7eqrio9vmjovhaspmfbcf0s66af2hr.apps.googleusercontent.com";
const GDRIVE_SCOPE     = "https://www.googleapis.com/auth/drive.file";

/* ── EMAILJS ─────────────────────────────────────────────
   Template variables: {{to_email}} {{to_name}} {{area}}
   {{archivo}} {{fecha}} {{hora}} {{tamano}}
──────────────────────────────────────────────────────── */
const EMAILJS_CONFIG = {
  publicKey:  "gaScEoguCEcx7aFYT",
  serviceId:  "service_ybvnh3i",
  templateId: "template_8d6u82j"
};

/* Archivos ≤ este tamaño van a Firestore comprimido */
const UMBRAL_BYTES = 800 * 1024;
/* Límite máximo: 35 MB */
const MAX_BYTES    = 35 * 1024 * 1024;

const ADMIN_EMAILS = [
  "parametrosp.cte@gmail.com"
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

let db, auth, usuario = null;
let archivoSeleccionado = null;
let docsAdmin = [];
let pakoListo = false;
let gdriveToken = null;

/* ══════════════════════════════════
   FIREBASE INIT
══════════════════════════════════ */
async function initFirebase() {
  const { initializeApp }
    = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
  const { getFirestore, collection, addDoc, getDocs, orderBy, query, doc, getDoc }
    = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
  const { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
    createUserWithEmailAndPassword, signInWithEmailAndPassword,
    sendPasswordResetEmail, updateProfile }
    = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");

  const app = initializeApp(FIREBASE_CONFIG);
  db   = getFirestore(app);
  auth = getAuth(app);

  window._fb = {
    collection, addDoc, getDocs, orderBy, query, doc, getDoc,
    GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
    createUserWithEmailAndPassword, signInWithEmailAndPassword,
    sendPasswordResetEmail, updateProfile
  };

  cargarPako();

  onAuthStateChanged(auth, u => {
    if (u) {
      usuario = { uid: u.uid, nombre: u.displayName, email: u.email, foto: u.photoURL };
      actualizarNav();
      esAdmin() ? show('nb-admin') : hide('nb-admin');
      show('nb-subir');
      irSubir();
    } else {
      usuario = null;
      gdriveToken = null;
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
   GOOGLE DRIVE — OBTENER TOKEN
══════════════════════════════════ */
function obtenerTokenDrive() {
  if (gdriveToken) return Promise.resolve(gdriveToken);

  return new Promise((resolve, reject) => {
    function iniciar() {
      // Intento silencioso primero
      const silent = google.accounts.oauth2.initTokenClient({
        client_id: GDRIVE_CLIENT_ID,
        scope: GDRIVE_SCOPE,
        prompt: 'none',
        callback: (resp) => {
          if (resp.error) {
            // Pedir permiso explícito
            const explicit = google.accounts.oauth2.initTokenClient({
              client_id: GDRIVE_CLIENT_ID,
              scope: GDRIVE_SCOPE,
              callback: (r) => {
                if (r.error) reject(new Error('Permiso de Google Drive denegado'));
                else { gdriveToken = r.access_token; resolve(gdriveToken); }
              }
            });
            explicit.requestAccessToken();
          } else {
            gdriveToken = resp.access_token;
            resolve(gdriveToken);
          }
        }
      });
      silent.requestAccessToken();
    }

    if (window.google?.accounts?.oauth2) {
      iniciar();
    } else {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = iniciar;
      s.onerror = () => reject(new Error('No se pudo cargar Google Identity Services'));
      document.head.appendChild(s);
    }
  });
}

/* ══════════════════════════════════
   GOOGLE DRIVE — SUBIR ARCHIVO
══════════════════════════════════ */
async function subirAGoogleDrive(file, onProgress) {
  const token = await obtenerTokenDrive();

  // Buscar o crear carpeta SISCTE_Entregas
  const carpetaId = await obtenerOCrearCarpeta(token, 'SISCTE_Entregas');

  // Subir archivo con progreso real
  return await subirArchivoConProgreso(token, file, carpetaId, onProgress);
}

async function obtenerOCrearCarpeta(token, nombre) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${nombre}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  if (data.files?.length > 0) return data.files[0].id;

  const crear = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nombre, mimeType: 'application/vnd.google-apps.folder' })
  });
  const carpeta = await crear.json();
  return carpeta.id;
}

function subirArchivoConProgreso(token, file, carpetaId, onProgress) {
  return new Promise(async (resolve, reject) => {
    try {
      // PASO 1: Iniciar sesión de subida resumable
      const initRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Upload-Content-Type': file.type || 'application/octet-stream',
            'X-Upload-Content-Length': file.size
          },
          body: JSON.stringify({ name: file.name, parents: [carpetaId] })
        }
      );

      if (!initRes.ok) {
        const err = await initRes.text();
        throw new Error(`Error iniciando subida: ${initRes.status} — ${err}`);
      }

      // La URL de subida viene en el header Location
      const uploadUrl = initRes.headers.get('Location');
      if (!uploadUrl) throw new Error('No se obtuvo URL de subida resumable');

      // PASO 2: Subir el binario directamente con XHR para tener progreso
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && onProgress) {
          const pct = Math.round(10 + (ev.loaded / ev.total) * 82);
          const mb  = (ev.loaded / (1024 * 1024)).toFixed(1);
          const tot = (ev.total  / (1024 * 1024)).toFixed(1);
          onProgress(pct, `Subiendo a Google Drive: ${mb} MB de ${tot} MB...`);
        }
      };

      xhr.onload = async () => {
        if (xhr.status === 200 || xhr.status === 201) {
          const result = JSON.parse(xhr.responseText);
          // Hacer el archivo accesible a cualquiera con el link
          await fetch(`https://www.googleapis.com/drive/v3/files/${result.id}/permissions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'reader', type: 'anyone' })
          });
          resolve({
            fileId:    result.id,
            driveLink: `https://drive.google.com/uc?export=download&id=${result.id}`,
            driveVista:`https://drive.google.com/file/d/${result.id}/view`
          });
        } else {
          reject(new Error(`Error al subir: ${xhr.status} — ${xhr.responseText}`));
        }
      };
      xhr.onerror = () => reject(new Error('Error de red al subir a Google Drive'));

      // Enviar el File directamente (binario puro, sin base64)
      xhr.send(file);

    } catch(e) { reject(e); }
  });
}

/* ══════════════════════════════════
   AUTH
══════════════════════════════════ */
async function login() {
  try {
    const provider = new window._fb.GoogleAuthProvider();
    provider.addScope(GDRIVE_SCOPE);
    await window._fb.signInWithPopup(auth, provider);
  } catch(e) { toast('Error al iniciar sesión: ' + e.message, 'err'); }
}

async function logout() {
  try { gdriveToken = null; await window._fb.signOut(auth); } catch(e) {}
}

async function loginEmail() {
  const email = document.getElementById('login-email')?.value?.trim();
  const pass  = document.getElementById('login-pass')?.value;
  if (!email || !pass) { toast('Ingresa correo y contraseña','err'); return; }
  try {
    await window._fb.signInWithEmailAndPassword(auth, email, pass);
  } catch(e) {
    const msg = e.code==='auth/invalid-credential' ? 'Correo o contraseña incorrectos'
              : e.code==='auth/user-not-found'     ? 'No existe una cuenta con ese correo'
              : e.code==='auth/wrong-password'     ? 'Contraseña incorrecta'
              : 'Error: '+e.message;
    toast(msg,'err');
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
    usuario = { uid: cred.user.uid, nombre, email: cred.user.email, foto: null };
    actualizarNav();
    irSubir();
    toast('Cuenta creada exitosamente ✓');
  } catch(e) {
    const msg = e.code==='auth/email-already-in-use' ? 'Ya existe una cuenta con ese correo'
              : e.code==='auth/invalid-email'        ? 'Correo no válido'
              : e.code==='auth/weak-password'        ? 'La contraseña es muy débil'
              : 'Error: '+e.message;
    toast(msg,'err');
  }
}

async function olvidoContrasena() {
  const email = document.getElementById('login-email')?.value?.trim();
  if (!email) { toast('Ingresa primero tu correo','err'); return; }
  try {
    await window._fb.sendPasswordResetEmail(auth, email);
    toast('Correo de recuperación enviado ✓');
  } catch(e) { toast('No se encontró cuenta con ese correo','err'); }
}

window.switchTab = function(tab) {
  document.getElementById('panel-login').style.display    = tab==='login'    ? 'block' : 'none';
  document.getElementById('panel-registro').style.display = tab==='registro' ? 'block' : 'none';
  document.getElementById('tab-login').classList.toggle('active',    tab==='login');
  document.getElementById('tab-registro').classList.toggle('active', tab==='registro');
};

const esAdmin = () =>
  usuario && ADMIN_EMAILS.map(x=>x.toLowerCase()).includes(usuario.email.toLowerCase());

/* ══════════════════════════════════
   DOM HELPERS
══════════════════════════════════ */
const $       = id => document.getElementById(id);
const show    = id => { const e=$(id); if(e) e.style.display='block'; };
const hide    = id => { const e=$(id); if(e) e.style.display='none';  };
const hideAll = () => ['vista-login','vista-subir','vista-exito','vista-admin'].forEach(hide);

function ir(v) {
  hideAll();
  const el = $(v); if (!el) return;
  el.style.display = (v==='vista-login') ? 'flex' : 'block';
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  if (v==='vista-subir'||v==='vista-exito') $('nb-subir')?.classList.add('active');
  if (v==='vista-admin') $('nb-admin')?.classList.add('active');
}

function toast(msg, tipo='ok') {
  const t=$('toast');
  t.textContent=msg;
  t.className=`toast toast--${tipo} toast--on`;
  clearTimeout(t._t);
  t._t=setTimeout(()=>t.className='toast',4200);
}

function actualizarNav() {
  if (usuario) {
    const fotoEl = $('nav-foto');
    if (usuario.foto) {
      fotoEl.src=usuario.foto; fotoEl.style.display='block';
      const ie=$('nav-iniciales'); if(ie) ie.style.display='none';
    } else {
      fotoEl.style.display='none';
      let ie=$('nav-iniciales');
      if (!ie) {
        ie=document.createElement('div'); ie.id='nav-iniciales';
        ie.style.cssText='width:26px;height:26px;border-radius:50%;background:var(--blue);color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
        fotoEl.parentNode.insertBefore(ie, fotoEl.nextSibling);
      }
      const n=usuario.nombre||usuario.email||'?', p=n.trim().split(' ');
      ie.textContent=p.length>=2?(p[0][0]+p[1][0]).toUpperCase():n.slice(0,2).toUpperCase();
      ie.style.display='flex';
    }
    $('nav-nombre').textContent=usuario.nombre?.split(' ')[0]||usuario.email;
    show('nav-sesion'); hide('nav-guest');
    esAdmin()?show('nb-admin'):hide('nb-admin');
    show('nb-subir');
  } else {
    hide('nav-sesion'); show('nav-guest'); hide('nb-admin');
  }
}

function resetBtn() {
  const btn=$('btn-enviar'); if(!btn) return;
  btn.disabled=false;
  btn.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Registrar Envío`;
}

/* ══════════════════════════════════
   ÁREAS
══════════════════════════════════ */
function poblarAreas(selectId, placeholder='— Selecciona tu área —') {
  const sel=$(selectId); if(!sel) return;
  sel.innerHTML=`<option value="">${placeholder}</option>`;
  AREAS.forEach(a=>{ const o=document.createElement('option'); o.value=a; o.textContent=a; sel.appendChild(o); });
}

/* ══════════════════════════════════
   VISTA SUBIR
══════════════════════════════════ */
function irSubir() {
  archivoSeleccionado=null;
  $('dropzone').style.display='flex';
  $('file-preview').style.display='none';
  $('progress-wrap').style.display='none';
  $('area-select').value='';
  const det=$('detalle-envio'); if(det) det.value='';
  resetBtn();
  const hn=$('hero-nombre'); if(hn) hn.textContent=usuario.nombre||usuario.email;
  ir('vista-subir');
  cargarMisEnvios();
}

/* ══════════════════════════════════
   MIS ENVÍOS
══════════════════════════════════ */
async function cargarMisEnvios() {
  const lista=$('mis-envios-lista');
  if(!lista||!usuario) return;
  lista.innerHTML=`<div class="mis-envios-vacio"><p style="font-size:12px;color:var(--txt3);">Cargando tus envíos...</p></div>`;
  try {
    const { where, orderBy } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const q=window._fb.query(
      window._fb.collection(db,'entregas'),
      where('uid','==',usuario.uid),
      orderBy('timestamp','desc')
    );
    const snap=await window._fb.getDocs(q);
    const docs=snap.docs.map(d=>({id:d.id,...d.data()}));
    if(docs.length===0){
      lista.innerHTML=`<div class="mis-envios-vacio">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
        <p>No hay envíos registrados todavía.</p></div>`;
      return;
    }
    lista.innerHTML=docs.map(d=>`
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
            ${d.metodo==='google_drive'?'&nbsp;·&nbsp;<span style="color:#16a34a;font-size:10px;font-weight:700;">📁 Drive</span>':''}
            ${d.archivado?'&nbsp;·&nbsp;<span style="color:var(--txt3);font-size:10px;font-weight:600;">Archivado</span>':''}
          </div>
        </div>
      </div>`).join('');
  } catch(e) {
    lista.innerHTML=`<div class="mis-envios-vacio"><p style="color:var(--red);font-size:11px;">Error: ${e.message}</p></div>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initFirebase();
  poblarAreas('area-select');
  poblarAreas('filtro-area','Todas las áreas');

  $('btn-google').addEventListener('click', login);
  document.getElementById('btn-login-email')?.addEventListener('click', loginEmail);
  document.getElementById('btn-registrar')?.addEventListener('click', registrarEmail);
  document.getElementById('btn-forgot')?.addEventListener('click', olvidoContrasena);
  document.querySelectorAll('.btn-logout').forEach(b=>b.addEventListener('click',logout));
  $('nb-subir').addEventListener('click', ()=>usuario?irSubir():ir('vista-login'));
  $('nb-admin').addEventListener('click', ()=>{ if(esAdmin()){ ir('vista-admin'); cargarAdmin(); } });
  $('btn-enviar-otro').addEventListener('click', irSubir);

  const dz=$('dropzone');
  dz.addEventListener('dragover', e=>{ e.preventDefault(); dz.classList.add('dz-over'); });
  dz.addEventListener('dragleave', ()=>dz.classList.remove('dz-over'));
  dz.addEventListener('drop', e=>{ e.preventDefault(); dz.classList.remove('dz-over'); if(e.dataTransfer.files[0]) seleccionar(e.dataTransfer.files[0]); });
  dz.addEventListener('click', ()=>$('file-input').click());
  $('file-input').addEventListener('change', ()=>{ if($('file-input').files[0]) seleccionar($('file-input').files[0]); });
  $('btn-cambiar').addEventListener('click', ()=>{ archivoSeleccionado=null; $('file-preview').style.display='none'; $('dropzone').style.display='flex'; });
  $('btn-enviar').addEventListener('click', enviarArchivo);
  $('btn-filtrar').addEventListener('click', aplicarFiltros);
  $('btn-limpiar').addEventListener('click', limpiarFiltros);
  $('btn-excel').addEventListener('click', ()=>exportarExcel(docsAdmin,false));
  $('btn-excel-filtrado').addEventListener('click', exportarFiltrado);
});

/* ── VALIDACIÓN ── */
function seleccionar(f) {
  const ext=f.name.split('.').pop().toLowerCase();
  if(!['xlsx','xls'].includes(ext)){ toast('Solo se aceptan archivos Excel (.xlsx o .xls)','err'); return; }
  if(f.size>MAX_BYTES){ toast(`El archivo supera el límite de 35 MB (${formatSize(f.size)})`,'err'); return; }
  archivoSeleccionado=f;
  $('fp-nombre').textContent=f.name;
  $('fp-peso').textContent=formatSize(f.size);
  const modo=f.size<=UMBRAL_BYTES?'⚡ Se guardará comprimido en Firestore':'📁 Se subirá a Google Drive (gratis)';
  const me=$('fp-modo'); if(me) me.textContent=modo;
  $('dropzone').style.display='none';
  $('file-preview').style.display='flex';
}

function formatSize(bytes) {
  if(bytes>=1024*1024) return (bytes/(1024*1024)).toFixed(2)+' MB';
  return (bytes/1024).toFixed(1)+' KB';
}

function fileToArrayBuffer(file) {
  return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsArrayBuffer(file); });
}

function arrayBufferToBase64(buf) {
  let bin=''; const bytes=new Uint8Array(buf instanceof ArrayBuffer?buf:buf.buffer);
  for(let i=0;i<bytes.length;i+=8192) bin+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(bin);
}

function setProgreso(pct,label) {
  $('progress-bar').style.width=pct+'%';
  $('progress-txt').textContent=pct+'%';
  const l=$('progress-label-txt'); if(l) l.textContent=label||'';
}

/* ══════════════════════════════════
   ENVIAR ARCHIVO
   ≤ 800 KB → Firestore comprimido
   > 800 KB → Google Drive (gratis)
══════════════════════════════════ */
async function enviarArchivo() {
  if(!archivoSeleccionado){ toast('Selecciona un archivo primero','err'); return; }
  const areaVal=$('area-select').value;
  if(!areaVal){ toast('Debes seleccionar tu área antes de enviar','err'); return; }
  const detalleVal=($('detalle-envio')?.value||'').trim();

  const btn=$('btn-enviar');
  btn.disabled=true;
  btn.innerHTML='<span class="spinner"></span> Subiendo...';
  $('progress-wrap').style.display='block';
  setProgreso(5,'Preparando...');

  try {
    const ahora=new Date();
    const fechaTexto=ahora.toLocaleDateString('es-EC',{timeZone:'America/Guayaquil',day:'2-digit',month:'long',year:'numeric'});
    const horaTexto=ahora.toLocaleTimeString('es-EC',{timeZone:'America/Guayaquil',hour:'2-digit',minute:'2-digit',second:'2-digit'});

    let metodo, driveFileId=null, driveLink=null, driveVista=null;
    let archivoBase64=null, tamComp=null;

    /* ─── Firestore comprimido (≤ 800 KB) ─── */
    if(archivoSeleccionado.size<=UMBRAL_BYTES){
      metodo='firestore_comprimido';
      setProgreso(20,'Leyendo archivo...');
      const buffer=await fileToArrayBuffer(archivoSeleccionado);
      setProgreso(40,'Comprimiendo con gzip...');
      if(!pakoListo) await cargarPako();
      if(window.pako){
        const comp=window.pako.gzip(new Uint8Array(buffer));
        archivoBase64=arrayBufferToBase64(comp);
        tamComp=formatSize(comp.length);
        setProgreso(70,`Comprimido → ${tamComp}`);
      } else {
        archivoBase64=arrayBufferToBase64(buffer);
        setProgreso(70,'Listo...');
      }

    /* ─── Google Drive (> 800 KB) ─── */
    } else {
      metodo='google_drive';
      setProgreso(8,'Conectando con Google Drive...');
      toast('Se abrirá un pop-up para autorizar Google Drive ✓');

      const resultado=await subirAGoogleDrive(
        archivoSeleccionado,
        (pct,label)=>setProgreso(pct,label)
      );
      driveFileId=resultado.fileId;
      driveLink  =resultado.driveLink;
      driveVista =resultado.driveVista;
      setProgreso(92,'Guardando registro...');
    }

    setProgreso(96,'Registrando en Firestore...');

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
      driveFileId,
      driveLink,
      driveVista,
      archivoBase64,
      comprimido:       (metodo==='firestore_comprimido' && !!window.pako),
      mimeType:         archivoSeleccionado.type||'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      detalle:          detalleVal,
      fechaTexto,
      horaTexto,
      timestamp:        ahora.toISOString()
    });

    setProgreso(100,'¡Completado!');
    mostrarExito(areaVal,fechaTexto,horaTexto);
    enviarCorreoNotificacion({
      nombre:usuario.nombre, email:usuario.email,
      area:areaVal, archivo:archivoSeleccionado.name,
      tamano:formatSize(archivoSeleccionado.size),
      fecha:fechaTexto, hora:horaTexto
    });
    setTimeout(()=>ir('vista-exito'),500);

  } catch(err) {
    console.error(err);
    toast('Error al subir: '+err.message,'err');
    $('progress-wrap').style.display='none';
    resetBtn();
  }
}

function mostrarExito(area,fecha,hora) {
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
    if(!window.emailjs){
      await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js'; s.onload=res; s.onerror=rej; document.head.appendChild(s); });
      emailjs.init(EMAILJS_CONFIG.publicKey);
    }
    await emailjs.send(EMAILJS_CONFIG.serviceId,EMAILJS_CONFIG.templateId,{
      to_email:datos.email, to_name:datos.nombre,
      area:datos.area, archivo:datos.archivo,
      tamano:datos.tamano, fecha:datos.fecha, hora:datos.hora
    });
    toast('Correo de confirmación enviado ✓');
  } catch(e){ console.warn('EmailJS:',e.message||e); }
}

/* ══════════════════════════════════
   PANEL ADMIN
══════════════════════════════════ */
async function cargarAdmin() {
  $('tabla-body').innerHTML=`<tr><td colspan="9" class="td-vacio">Cargando...</td></tr>`;
  $('admin-personas').innerHTML=`<p class="cargando-txt">Cargando...</p>`;
  try {
    const q=window._fb.query(window._fb.collection(db,'entregas'),window._fb.orderBy('timestamp','desc'));
    const snap=await window._fb.getDocs(q);
    docsAdmin=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderAdmin(docsAdmin);
  } catch(e){ console.error(e); toast('Error al cargar: '+e.message,'err'); }
}

function renderAdmin(docs) {
  const unicos=[...new Set(docs.map(d=>d.email))];
  $('st-total').textContent  = docs.length;
  $('st-unicos').textContent = unicos.length;
  $('st-ultimo').textContent = docs.length?`${docs[0].fechaTexto} · ${docs[0].horaTexto}`:'Sin entregas aún';

  const porPersona={};
  docs.forEach(d=>{
    if(!porPersona[d.email]) porPersona[d.email]={...d,cant:0,areas:new Set()};
    porPersona[d.email].cant++;
    if(d.area) porPersona[d.email].areas.add(d.area);
  });
  $('admin-personas').innerHTML=Object.values(porPersona).sort((a,b)=>b.cant-a.cant).map(p=>`
    <div class="persona-row">
      <img class="persona-foto" src="${p.foto||avatar(p.nombre)}" alt="" onerror="this.src='${avatar(p.nombre)}'">
      <div class="persona-info">
        <div class="persona-nombre">${p.nombre||'—'}</div>
        <div class="persona-email">${p.email}</div>
        <div class="persona-ultima">Área(s): ${[...p.areas].join(', ')||'—'} · Último: ${p.fechaTexto} · ${p.horaTexto}</div>
      </div>
      <span class="persona-badge">${p.cant} archivo${p.cant>1?'s':''}</span>
    </div>`).join('')||'<p class="cargando-txt">Sin entregas</p>';

  $('tabla-body').innerHTML=docs.length===0
    ?`<tr><td colspan="9" class="td-vacio">No hay registros</td></tr>`
    :docs.map((d,i)=>`
      <tr class="${d.archivado?'tr-archivado':''}">
        <td class="td-n">${i+1}</td>
        <td><div class="td-user">
          <img class="td-foto" src="${d.foto||avatar(d.nombre)}" alt="" onerror="this.src='${avatar(d.nombre)}'">
          <div><div class="td-nombre">${d.nombre||'—'}</div><div class="td-email">${d.email}</div></div>
        </div></td>
        <td><span class="badge-area">${d.area||'—'}</span></td>
        <td class="td-arch">${renderDescarga(d)}</td>
        <td class="td-detalle" title="${d.detalle||'—'}">${d.detalle?(d.detalle.length>40?d.detalle.slice(0,40)+'…':d.detalle):'<span style="color:#9ca3af">—</span>'}</td>
        <td class="td-peso">${d.tamanoTexto||'—'}${d.tamanoComprimido?`<div class="td-comprimido">gzip: ${d.tamanoComprimido}</div>`:''}</td>
        <td class="td-fecha">${d.fechaTexto}</td>
        <td class="td-hora">${d.horaTexto}</td>
        <td>${d.archivado?`<span class="badge-archivado">Archivado</span>`:`<span class="badge-activo">Activo</span>`}</td>
      </tr>`).join('');

  $('filtro-resultado').textContent=`${docs.length} registro${docs.length!==1?'s':''} encontrado${docs.length!==1?'s':''}`;
}

function renderDescarga(d) {
  const svg=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
  if(d.driveLink)
    return `<a href="${d.driveLink}" target="_blank" class="link-archivo">${svg}${d.nombreArchivo}<span style="font-size:10px;color:#16a34a;margin-left:4px;font-weight:700;">📁</span></a>`;
  if(d.archivoBase64)
    return `<button onclick="descargarFirestore('${d.id}')" class="link-archivo" style="background:none;border:none;cursor:pointer;padding:0;font-family:inherit;">${svg}${d.nombreArchivo}</button>`;
  return `<span style="color:var(--txt3);font-size:12px;">${d.nombreArchivo||'—'}</span>`;
}

window.descargarFirestore = async function(docId) {
  try {
    toast('Preparando descarga...','ok');
    if(!pakoListo) await cargarPako();
    const snap=await window._fb.getDoc(window._fb.doc(db,'entregas',docId));
    if(!snap.exists()){ toast('Archivo no encontrado','err'); return; }
    const d=snap.data();
    const binary=atob(d.archivoBase64); const bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
    const datos=(d.comprimido&&window.pako)?window.pako.ungzip(bytes):bytes;
    const blob=new Blob([datos],{type:d.mimeType});
    const url=URL.createObjectURL(blob); const a=document.createElement('a');
    a.href=url; a.download=d.nombreArchivo; a.click(); URL.revokeObjectURL(url);
    toast('Descarga iniciada ✓');
  } catch(e){ toast('Error al descargar: '+e.message,'err'); }
};

/* ══════════════════════════════════
   FILTROS
══════════════════════════════════ */
function filtrarDocs(docs) {
  const area=$('filtro-area').value.toLowerCase();
  const nombre=$('filtro-nombre').value.trim().toLowerCase();
  const email=$('filtro-email').value.trim().toLowerCase();
  const fechaD=$('filtro-fecha-desde').value;
  const fechaH=$('filtro-fecha-hasta').value;
  let r=[...docs];
  if(area)   r=r.filter(d=>(d.area||'').toLowerCase().includes(area));
  if(nombre) r=r.filter(d=>(d.nombre||'').toLowerCase().includes(nombre));
  if(email)  r=r.filter(d=>(d.email||'').toLowerCase().includes(email));
  if(fechaD) r=r.filter(d=>d.timestamp>=new Date(fechaD).toISOString());
  if(fechaH){ const h=new Date(fechaH); h.setHours(23,59,59); r=r.filter(d=>d.timestamp<=h.toISOString()); }
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
const avatar=n=>`https://ui-avatars.com/api/?name=${encodeURIComponent(n||'?')}&background=1d4ed8&color=fff`;

async function exportarExcel(docs,filtrado=false){
  if(!window.XLSX){
    await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload=res; s.onerror=rej; document.head.appendChild(s); });
  }
  const filas=docs.map((d,i)=>({
    '#':i+1,'Nombre':d.nombre||'—','Correo':d.email||'—','Área':d.area||'—',
    'Archivo':d.nombreArchivo||'—','Descripción':d.detalle||'—','Peso':d.tamanoTexto||'—',
    'Link Drive':d.driveLink||'—','Fecha':d.fechaTexto||'—','Hora':d.horaTexto||'—',
    'Estado':d.archivado?'ARCHIVADO':'Activo'
  }));
  const wb=XLSX.utils.book_new(), ws=XLSX.utils.json_to_sheet(filas);
  ws['!cols']=[{wch:4},{wch:28},{wch:34},{wch:22},{wch:38},{wch:40},{wch:12},{wch:50},{wch:22},{wch:14},{wch:12}];
  XLSX.utils.book_append_sheet(wb,ws,'Entregas');
  XLSX.writeFile(wb,`informe_SISCTE${filtrado?'_filtrado':'_completo'}_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast(`Informe${filtrado?' filtrado':''} descargado ✓`);
}

/* ══════════════════════════════════
   ARCHIVADO MENSUAL
══════════════════════════════════ */
window.verificarChecks=function(){
  const ok=$('check1')?.checked&&$('check2')?.checked&&$('check3')?.checked;
  const btn=$('arch-btn-descargar'); if(btn) btn.disabled=!ok;
};

function abrirModalArchivado(){
  const mesesMap={};
  docsAdmin.forEach(d=>{
    if(d.archivado) return;
    if(!d.archivoBase64&&!d.driveLink) return;
    const mes=d.timestamp.slice(0,7);
    if(!mesesMap[mes]) mesesMap[mes]={docs:[],label:labelMes(d.timestamp)};
    mesesMap[mes].docs.push(d);
  });
  const meses=Object.entries(mesesMap).sort((a,b)=>b[0].localeCompare(a[0]));
  if(meses.length===0){ toast('No hay archivos pendientes de archivar','ok'); return; }
  const sel=$('arch-mes-select');
  sel.innerHTML='<option value="">— Selecciona el mes —</option>';
  meses.forEach(([key,val])=>{ const o=document.createElement('option'); o.value=key; o.textContent=`${val.label} (${val.docs.length} archivo${val.docs.length>1?'s':''})`; sel.appendChild(o); });
  window._archMeses=mesesMap;
  $('modal-archivado').style.display='flex';
  $('arch-paso1').style.display='block';
  $('arch-paso2').style.display='none';
  $('arch-paso3').style.display='none';
  $('arch-btn-siguiente').disabled=true;
}

function labelMes(iso){ const d=new Date(iso); return d.toLocaleDateString('es-EC',{month:'long',year:'numeric',timeZone:'America/Guayaquil'}); }

function seleccionarMesArchivado(){
  const mes=$('arch-mes-select').value;
  $('arch-btn-siguiente').disabled=!mes;
  if(!mes) return;
  const info=window._archMeses[mes];
  $('arch-resumen').innerHTML=`
    <div class="arch-stat"><span>${info.docs.length}</span> archivos a archivar</div>
    <div class="arch-personas">
      ${info.docs.map(d=>`<div class="arch-persona-row">
        <img src="${d.foto||avatar(d.nombre)}" alt="" onerror="this.src='${avatar(d.nombre)}'">
        <div>
          <div class="arch-persona-nombre">${d.nombre||'—'} <span class="badge-area" style="font-size:10px">${d.area||''}</span></div>
          <div class="arch-persona-archivo">${d.nombreArchivo} · ${d.tamanoTexto||'—'} ${d.metodo==='google_drive'?'· 📁 Drive':''}</div>
        </div></div>`).join('')}
    </div>`;
}

function archPaso2(){
  const mes=$('arch-mes-select').value; if(!mes) return;
  $('arch-paso1').style.display='none'; $('arch-paso2').style.display='block';
  const info=window._archMeses[mes];
  $('arch-advertencia-detalle').textContent=
    `Se procesarán ${info.docs.length} archivo(s) de ${labelMes(info.docs[0].timestamp)}. `+
    `Archivos en Firestore se descargarán al PC. Archivos en Google Drive quedan en el Drive del usuario. El historial queda siempre.`;
}

async function descargarMesCompleto(){
  const mes=$('arch-mes-select').value, info=window._archMeses[mes];
  if(!pakoListo) await cargarPako();
  $('arch-paso2').style.display='none'; $('arch-paso3').style.display='block';
  $('arch-progreso-txt').textContent='Procesando archivos...';
  let ok=0;
  for(let i=0;i<info.docs.length;i++){
    const d=info.docs[i];
    $('arch-progreso-bar').style.width=Math.round(((i+1)/info.docs.length)*100)+'%';
    $('arch-progreso-txt').textContent=`Procesando ${i+1} de ${info.docs.length}: ${d.nombreArchivo}`;
    try{
      if(d.archivoBase64){
        const bin=atob(d.archivoBase64), bytes=new Uint8Array(bin.length);
        for(let j=0;j<bin.length;j++) bytes[j]=bin.charCodeAt(j);
        const datos=(d.comprimido&&window.pako)?window.pako.ungzip(bytes):bytes;
        const blob=new Blob([datos],{type:d.mimeType}), url=URL.createObjectURL(blob), a=document.createElement('a');
        a.href=url; a.download=d.nombreArchivo; a.click(); URL.revokeObjectURL(url);
      }
      // Archivos Drive: ya están en Drive, no hay que hacer nada
      ok++;
    } catch(e){ console.warn(e); }
    await new Promise(r=>setTimeout(r,300));
  }
  $('arch-progreso-txt').textContent=`✓ ${ok} de ${info.docs.length} archivos procesados`;
  $('arch-btn-archivar').style.display='block';
  $('arch-btn-archivar').onclick=()=>confirmarArchivar(mes,info.docs);
}

async function confirmarArchivar(mes,docs){
  $('arch-btn-archivar').disabled=true;
  $('arch-btn-archivar').textContent='Archivando...';
  try{
    const {doc,updateDoc}=await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    let n=0;
    for(const d of docs){
      $('arch-progreso-bar').style.width=Math.round(((n+1)/docs.length)*100)+'%';
      await updateDoc(doc(db,'entregas',d.id),{
        archivoBase64:null, archivado:true,
        fechaArchivado:new Date().toISOString(),
        notaArchivado:`Archivado el ${new Date().toLocaleDateString('es-EC',{timeZone:'America/Guayaquil',day:'2-digit',month:'long',year:'numeric'})}`
      });
      n++; await new Promise(r=>setTimeout(r,150));
    }
    $('arch-progreso-txt').textContent=`✓ ${n} registros archivados. Historial conservado.`;
    $('arch-btn-archivar').textContent='✓ Archivado completado';
    setTimeout(async()=>{ cerrarModalArchivado(); await cargarAdmin(); toast(`Mes ${labelMes(docs[0].timestamp)} archivado ✓`); },2000);
  } catch(e){
    toast('Error al archivar: '+e.message,'err');
    $('arch-btn-archivar').disabled=false;
    $('arch-btn-archivar').textContent='Reintentar archivado';
  }
}

function cerrarModalArchivado(){ $('modal-archivado').style.display='none'; }

window.abrirModalArchivado     = abrirModalArchivado;
window.irSubir                 = irSubir;
window.cerrarModalArchivado    = cerrarModalArchivado;
window.seleccionarMesArchivado = seleccionarMesArchivado;
window.archPaso2               = archPaso2;
window.descargarMesCompleto    = descargarMesCompleto;
