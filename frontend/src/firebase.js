import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'

const firebaseConfig = {
  apiKey: 'AIzaSyBMtSAM8K4-tB5sG7Lre1y0rpe6NRZC5jU',
  authDomain: 'reconcile-ebay.firebaseapp.com',
  projectId: 'reconcile-ebay',
  storageBucket: 'reconcile-ebay.firebasestorage.app',
  messagingSenderId: '56167052491',
  appId: '1:56167052491:web:7cfadd10e8ccdfef98574e',
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
