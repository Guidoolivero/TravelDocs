import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { FIREBASE_CONFIG } from '../config.js';


// ==================== FIREBASE INIT ====================
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
export { app, auth };
