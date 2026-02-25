/* ── FIREBASE CONFIG ── */
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBF2Ivt-OGqNPpxMEUNt_f4Jd6uBpOhq2Y",
  authDomain:        "siscte2-e38de.firebaseapp.com",
  projectId:         "siscte2-e38de",
  storageBucket:     "siscte2-e38de.firebasestorage.app",
  messagingSenderId: "234056629895",
  appId:             "1:234056629895:web:a7f6953ccc7957a7398222"
};

/* ── ADMINISTRADORES ── */
const ADMIN_EMAILS = [
  "parametrosp.cte@gmail.com",
];

/* ─── Estado global ─── */
let db, auth, usuario = null;
let archivoSeleccionado = null;

/* ═══════════════════════════════════
   FIREBASE INIT (sin Storage)
═══════════════════════════════════ */
async function initFirebase() {
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
  const { getFirestore, collection, addDoc, getDocs, orderBy, query }
    = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
  const { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
    = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
  const { getStorage, ref, uploadBytesResumable, getDownloadURL }
    = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js");

  const app = initializeApp(FIREBASE_CONFIG);
  db      = getFirestore(app);
  auth    = getAuth(app);
  window._storage = getStorage(app);

  window._fb = {
    collection, addDoc, getDocs, orderBy, query,
    GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
    ref, uploadBytesResumable, getDownloadURL
  };

  onAuthStateChanged(auth, u => {
    if (u) {
      usuario = { uid: u.uid, nombre: u.displayName, email: u.email, foto: u.photoURL };
      actualizarNav();
      if (esAdmin()) show('nb-admin'); else hide('nb-admin');
      irSubir();
    } else {
      usuario = null;
      actualizarNav();
      ir('vista-login');
    }
  });
}

/* ═══════════════════════════════════
   AUTH
═══════════════════════════════════ */
async function login() {
  try {
    const provider = new window._fb.GoogleAuthProvider();
    await window._fb.signInWithPopup(auth, provider);
  } catch(e) { toast('Error al iniciar sesión: ' + e.message, 'err'); }
}

async function logout() {
  try { await window._fb.signOut(auth); } catch(e) {}
}

const esAdmin = () =>
  usuario && ADMIN_EMAILS.map(e => e.toLowerCase()).includes(usuario.email.toLowerCase());

/* ═══════════════════════════════════
   DOM HELPERS
═══════════════════════════════════ */
const $       = id => document.getElementById(id);
const show    = id => { const e=$(id); if(e) e.style.display='block'; };
const hide    = id => { const e=$(id); if(e) e.style.display='none';  };
const hideAll = () => ['vista-login','vista-subir','vista-exito','vista-admin'].forEach(hide);

function ir(v) {
  hideAll(); show(v);
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if (v==='vista-subir'||v==='vista-exito') $('nb-subir')?.classList.add('active');
  if (v==='vista-admin') $('nb-admin')?.classList.add('active');
}

function toast(msg, tipo='ok') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast toast--${tipo} toast--on`;
  clearTimeout(t._t);
  t._t = setTimeout(() => t.className = 'toast', 3600);
}

function actualizarNav() {
  if (usuario) {
    $('nav-foto').src = usuario.foto || '';
    $('nav-nombre').textContent = usuario.nombre?.split(' ')[0] || usuario.email;
    show('nav-sesion'); hide('nav-guest');
  } else {
    hide('nav-sesion'); show('nav-guest'); hide('nb-admin');
  }
}

function resetBtn() {
  const btn = $('btn-enviar');
  btn.disabled = false;
  btn.textContent = 'Enviar archivo';
}

/* ═══════════════════════════════════
   VISTA SUBIR
═══════════════════════════════════ */
function irSubir() {
  archivoSeleccionado = null;
  $('dropzone').style.display = 'flex';
  $('file-preview').style.display = 'none';
  $('progress-wrap').style.display = 'none';
  resetBtn();
  $('up-foto').src           = usuario.foto || '';
  $('up-nombre').textContent = usuario.nombre || '';
  $('up-email').textContent  = usuario.email  || '';
  ir('vista-subir');
}

document.addEventListener('DOMContentLoaded', () => {
  initFirebase();

  $('btn-google').addEventListener('click', login);
  document.querySelectorAll('.btn-logout').forEach(b => b.addEventListener('click', logout));
  $('nb-subir').addEventListener('click', () => usuario ? irSubir() : ir('vista-login'));
  $('nb-admin').addEventListener('click', () => { if (esAdmin()) { ir('vista-admin'); cargarAdmin(); } });
  $('btn-enviar-otro').addEventListener('click', irSubir);

  const dz = $('dropzone');
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('dz-over'); });
  dz.addEventListener('dragleave', ()  => dz.classList.remove('dz-over'));
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
});

/* ── VALIDACIÓN DE ARCHIVO ── */
function seleccionar(f) {
  const ext = f.name.split('.').pop().toLowerCase();
  if (!['xlsx','xls'].includes(ext)) {
    toast('Solo se aceptan archivos Excel (.xlsx o .xls)', 'err'); return;
  }
  // Firestore tiene límite de 1MB por documento, Excel pequeño = ok
  if (f.size > 10000 * 1024) {
    toast('El archivo no debe superar 10.000 KB', 'err'); return;
  }
  archivoSeleccionado = f;
  $('fp-nombre').textContent = f.name;
  $('fp-peso').textContent   = (f.size / 1024).toFixed(1) + ' KB';
  $('dropzone').style.display     = 'none';
  $('file-preview').style.display = 'flex';
}

/* fileToBase64 eliminado — ahora se usa Firebase Storage directamente */

/* ═══════════════════════════════════
   ENVÍO A FIREBASE STORAGE + FIRESTORE
═══════════════════════════════════ */
async function enviarArchivo() {
  if (!archivoSeleccionado) { toast('Selecciona un archivo primero', 'err'); return; }

  const btn = $('btn-enviar');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Subiendo...';

  $('progress-wrap').style.display = 'block';
  $('progress-bar').style.width = '0%';
  $('progress-txt').textContent = '0%';

  try {
    const ahora      = new Date();
    const fechaTexto = ahora.toLocaleDateString('es-EC', { timeZone:'America/Guayaquil', day:'2-digit', month:'long', year:'numeric' });
    const horaTexto  = ahora.toLocaleTimeString('es-EC', { timeZone:'America/Guayaquil', hour:'2-digit', minute:'2-digit', second:'2-digit' });

    // 1. Subir archivo a Firebase Storage
    const ruta      = `entregas/${usuario.uid}_${Date.now()}_${archivoSeleccionado.name}`;
    const storageRef = window._fb.ref(window._storage, ruta);
    const uploadTask = window._fb.uploadBytesResumable(storageRef, archivoSeleccionado);

    // 2. Escuchar progreso real de subida
    const downloadURL = await new Promise((resolve, reject) => {
      uploadTask.on('state_changed',
        (snapshot) => {
          const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 90);
          $('progress-bar').style.width = pct + '%';
          $('progress-txt').textContent = pct + '%';
        },
        (error) => reject(error),
        async () => {
          const url = await window._fb.getDownloadURL(uploadTask.snapshot.ref);
          resolve(url);
        }
      );
    });

    $('progress-bar').style.width = '95%';
    $('progress-txt').textContent = '95%';

    // 3. Guardar metadatos en Firestore (sin base64, solo la URL)
    await window._fb.addDoc(window._fb.collection(db, "entregas"), {
      uid:           usuario.uid,
      nombre:        usuario.nombre,
      email:         usuario.email,
      foto:          usuario.foto,
      nombreArchivo: archivoSeleccionado.name,
      tamanoKB:      +(archivoSeleccionado.size / 1024).toFixed(1),
      downloadURL,                // URL de descarga directa desde Storage
      rutaStorage:   ruta,        // ruta interna en Storage
      mimeType:      archivoSeleccionado.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fechaTexto,
      horaTexto,
      timestamp:     ahora.toISOString()
    });

    $('progress-bar').style.width = '100%';
    $('progress-txt').textContent = '100%';

    $('ex-nombre').textContent  = usuario.nombre;
    $('ex-email').textContent   = usuario.email;
    $('ex-archivo').textContent = archivoSeleccionado.name;
    $('ex-fecha').textContent   = fechaTexto;
    $('ex-hora').textContent    = horaTexto;

    setTimeout(() => ir('vista-exito'), 400);

  } catch(err) {
    console.error(err);
    toast('Error al subir: ' + err.message, 'err');
    $('progress-wrap').style.display = 'none';
    resetBtn();
  }
}

/* ═══════════════════════════════════
   PANEL ADMIN
═══════════════════════════════════ */
async function cargarAdmin() {
  $('tabla-body').innerHTML     = `<tr><td colspan="6" class="td-vacio">Cargando desde Firestore...</td></tr>`;
  $('admin-personas').innerHTML = `<p class="cargando-txt">Cargando...</p>`;

  try {
    const q    = window._fb.query(
      window._fb.collection(db, "entregas"),
      window._fb.orderBy("timestamp", "desc")
    );
    const snap = await window._fb.getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const unicos = [...new Set(docs.map(d => d.email))];
    $('st-total').textContent  = docs.length;
    $('st-unicos').textContent = unicos.length;
    $('st-ultimo').textContent = docs.length
      ? `${docs[0].fechaTexto} · ${docs[0].horaTexto}`
      : 'Sin entregas aún';

    const porPersona = {};
    docs.forEach(d => {
      if (!porPersona[d.email]) porPersona[d.email] = { ...d, cant: 0 };
      porPersona[d.email].cant++;
    });

    $('admin-personas').innerHTML = Object.values(porPersona)
      .sort((a,b) => b.cant - a.cant)
      .map(p => `
        <div class="persona-row">
          <img class="persona-foto" src="${p.foto || avatar(p.nombre)}" alt="">
          <div class="persona-info">
            <div class="persona-nombre">${p.nombre || '—'}</div>
            <div class="persona-email">${p.email}</div>
            <div class="persona-ultima">Último: ${p.fechaTexto} · ${p.horaTexto}</div>
          </div>
          <span class="persona-badge">${p.cant} archivo${p.cant>1?'s':''}</span>
        </div>`).join('') || '<p class="cargando-txt">Sin entregas aún</p>';

    $('tabla-body').innerHTML = docs.length === 0
      ? `<tr><td colspan="6" class="td-vacio">No hay entregas aún</td></tr>`
      : docs.map((d,i) => `
          <tr>
            <td class="td-n">${i+1}</td>
            <td>
              <div class="td-user">
                <img class="td-foto" src="${d.foto || avatar(d.nombre)}" alt="">
                <div>
                  <div class="td-nombre">${d.nombre || '—'}</div>
                  <div class="td-email">${d.email}</div>
                </div>
              </div>
            </td>
            <td class="td-arch">
              <button onclick="descargarArchivo('${d.id}')" class="link-archivo" style="background:none;border:none;cursor:pointer;padding:0;font-family:inherit;color:var(--blue);font-weight:500;display:flex;align-items:center;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                ${d.nombreArchivo}
              </button>
            </td>
            <td class="td-peso">${d.tamanoKB} KB</td>
            <td class="td-fecha">${d.fechaTexto}</td>
            <td class="td-hora">${d.horaTexto}</td>
          </tr>`).join('');

    $('btn-excel').onclick = () => exportarExcel(docs);

  } catch(e) {
    console.error(e);
    toast('Error al cargar: ' + e.message, 'err');
  }
}

/* ── Descarga el archivo desde Firebase Storage ── */
window.descargarArchivo = async function(docId) {
  try {
    toast('Preparando descarga...', 'ok');
    const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const snap = await getDoc(doc(db, "entregas", docId));
    if (!snap.exists()) { toast('Archivo no encontrado', 'err'); return; }
    const d = snap.data();
    // Si tiene URL de Storage, abrir directamente
    if (d.downloadURL) {
      const a = document.createElement('a');
      a.href = d.downloadURL;
      a.download = d.nombreArchivo;
      a.target = '_blank';
      a.click();
      toast('Descarga iniciada ✓');
    } else if (d.archivoBase64) {
      // Compatibilidad con registros antiguos guardados en base64
      const byteChars = atob(d.archivoBase64);
      const byteArr   = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
      const blob = new Blob([byteArr], { type: d.mimeType });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = d.nombreArchivo;
      a.click();
      URL.revokeObjectURL(url);
      toast('Descarga iniciada ✓');
    } else {
      toast('Archivo sin URL de descarga disponible', 'err');
    }
  } catch(e) {
    toast('Error al descargar: ' + e.message, 'err');
  }
};

const avatar = nombre =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(nombre)}&background=2563eb&color=fff`;

async function exportarExcel(docs) {
  if (!window.XLSX) {
    await new Promise((res,rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const filas = docs.map((d,i) => ({
    '#': i+1, 'Nombre': d.nombre||'—', 'Correo': d.email,
    'Archivo': d.nombreArchivo, 'Tamaño (KB)': d.tamanoKB,
    'Fecha': d.fechaTexto, 'Hora': d.horaTexto
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(filas);
  ws['!cols'] = [{wch:4},{wch:24},{wch:30},{wch:34},{wch:12},{wch:22},{wch:12}];
  XLSX.utils.book_append_sheet(wb, ws, 'Entregas');
  XLSX.writeFile(wb, `informe_entregas_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast('Informe Excel descargado ✓');
}
