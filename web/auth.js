// auth.js
// Robust UI state handling:
// - Works even if the project still mixes "hidden" and "is-hidden" classes.
// - Updates UI immediately from returned auth result (no reliance on getSession timing).
// - Always hides auth panel after successful login/register.

import { supabase } from './supabaseClient.js'

const $ = (id) => document.getElementById(id)

function show(el) {
  if (!el) return
  el.classList.remove('is-hidden')
  el.classList.remove('hidden')
}

function hide(el) {
  if (!el) return
  el.classList.add('is-hidden')
  el.classList.add('hidden')
}

function setMsg(text) {
  const el = $('authMsg')
  if (el) el.textContent = text ?? ''
}

function displayNameFromUser(user) {
  const meta = user?.user_metadata ?? {}
  return meta.full_name || meta.name || user?.email || 'User:in'
}

async function getUser() {
  // getUser() is more direct than getSession() for UI state
  const { data } = await supabase.auth.getUser()
  return data?.user ?? null
}

export function initAuthUI() {
  const loggedOutRow = $('authFooterLoggedOut')
  const loggedInRow = $('authFooterLoggedIn')
  const identity = $('authFooterIdentity')
  const openLoginBtn = $('authOpenLogin')
  const logoutBtn = $('authLogoutBtn')
  const drawerToggle = $('drawerToggle')
  const drawerBackdrop = $('drawerBackdrop')
  const languageToggleBtn = $('languageToggleBtn')

  const panel = $('authPanel')
  const tabLogin = $('tabLogin')
  const tabRegister = $('tabRegister')
  const rowName = $('rowName')

  const email = $('authEmail')
  const password = $('authPassword')
  const name = $('authName')

  const btnPrimary = $('btnPrimary')
  const btnForgot = $('btnForgotPw')

  // Hard fail visible in console if HTML IDs do not match
  const required = {
    loggedOutRow, loggedInRow, identity, openLoginBtn, logoutBtn,
    panel, tabLogin, tabRegister, rowName, email, password, name,
    btnPrimary, btnForgot
  }
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) {
    console.warn('[auth] Missing DOM refs:', missing)
    return
  }

  let mode = 'login' // 'login' | 'register'

  function setMode(nextMode) {
    mode = nextMode
    const isRegister = mode === 'register'

    tabLogin.classList.toggle('is-active', !isRegister)
    tabRegister.classList.toggle('is-active', isRegister)

    rowName.classList.toggle('is-hidden', !isRegister)
    rowName.classList.toggle('is-visible', isRegister)

    // Hide "Forgot password" on Register
    btnForgot.classList.toggle('is-hidden', isRegister)
    btnForgot.classList.toggle('is-visible', !isRegister)

    btnPrimary.textContent = isRegister ? window.i18n.getTranslation('register') : window.i18n.getTranslation('login')
    setMsg('')
  }

  function openPanel() {
    show(panel)
    hide(loggedOutRow)
    setMode('login')
  }

  function closePanel() {
    hide(panel)
    setMsg('')
    password.value = ''
    if (loggedInRow.classList.contains('is-hidden') || loggedInRow.classList.contains('hidden')) {
      show(loggedOutRow)
    }
  }

  function applyLoggedOutUI() {
    identity.textContent = ''
    show(loggedOutRow)
    hide(loggedInRow)
    password.value = ''
    closePanel()
    // Language toggle stays in header
  }

  function applyLoggedInUI(user) {
    const welcomeText = window.i18n ? window.i18n.getTranslation('welcome') : 'Willkommen';
    identity.textContent = welcomeText + ', ' + displayNameFromUser(user);
    hide(loggedOutRow);
    show(loggedInRow);
    closePanel();
    // Language toggle stays in header
  }

  async function refreshUI() {
    const user = await getUser()
    if (!user) applyLoggedOutUI()
    else applyLoggedInUI(user)
  }

  // Open auth panel
  openLoginBtn.addEventListener('click', openPanel)

  // Close login when closing drawer
  if (drawerToggle) drawerToggle.addEventListener('click', closePanel)
  if (drawerBackdrop) drawerBackdrop.addEventListener('click', closePanel)

  // Submit on Enter inside auth inputs
  panel.addEventListener('keydown', (evt) => {
    if (evt.key !== 'Enter') return
    const target = evt.target
    if (target && target.tagName === 'INPUT') {
      evt.preventDefault()
      btnPrimary.click()
    }
  })

  // Close when clicking anywhere outside the auth panel (menu or map)
  document.addEventListener('click', (evt) => {
    if (panel.classList.contains('is-hidden')) return
    const target = evt.target
    if (!target) return
    const insidePanel = panel.contains(target)
    const isLoginButton = target.closest('#authOpenLogin')
    if (!insidePanel && !isLoginButton) {
      closePanel()
    }
  })

  // Tabs
  tabLogin.addEventListener('click', () => setMode('login'))
  tabRegister.addEventListener('click', () => setMode('register'))

  // Login / Register primary action
  btnPrimary.addEventListener('click', async () => {
    setMsg('')

    const e = email.value.trim()
    const p = password.value
    if (!e || !p) {
      setMsg('Email and password are required.')
      return
    }

    if (mode === 'login') {
      const { data, error } = await supabase.auth.signInWithPassword({ email: e, password: p })
      if (error) { setMsg(error.message); return }

      // Immediate UI update from returned session user
      const user = data?.user || data?.session?.user
      if (user) applyLoggedInUI(user)
      else await refreshUI()
      return
    }

    // register
    const fullName = (name?.value ?? '').trim()
    const { data, error } = await supabase.auth.signUp({
      email: e,
      password: p,
      options: { data: fullName ? { full_name: fullName } : {} }
    })
    if (error) { setMsg(error.message); return }

    // With email confirmation, user might not have a session yet
    const user = data?.user
    if (user) {
      setMsg('Registered. Please check your inbox and confirm your email to activate your account.')
      // Keep panel open so the message stays visible
      return
    }

    setMsg('Registered. Please check your inbox and confirm your email to activate your account.')
  })

  // Forgot password
  btnForgot.addEventListener('click', async () => {
    setMsg('')
    const e = email.value.trim()
    if (!e) {
      setMsg('Please enter your email to send a reset.')
      return
    }
    const { error } = await supabase.auth.resetPasswordForEmail(e, {
      redirectTo: window.location.origin
    })
    if (error) { setMsg(error.message); return }
    setMsg('Password reset sent. Please check your inbox.')
  })

  // Logout
  logoutBtn.addEventListener('click', async () => {
    setMsg('')
    console.log('[auth] Logout button clicked')
    try {
      const { error } = await supabase.auth.signOut()
      if (error) {
        setMsg('Logout error: ' + error.message)
        console.error('Logout error:', error)
        return
      }
      setMsg('Logged out.')
      console.log('[auth] Logout success')
      applyLoggedOutUI()
    } catch (e) {
      setMsg('Logout Exception: ' + (e?.message || e))
      console.error('Logout Exception:', e)
    }
  })

  // Keep UI in sync (also covers refresh / token auto-refresh)
  supabase.auth.onAuthStateChange(async (_event, session) => {
    const user = session?.user
    if (user) applyLoggedInUI(user)
    else applyLoggedOutUI()
  })

  setMode('login')
  refreshUI()
}
