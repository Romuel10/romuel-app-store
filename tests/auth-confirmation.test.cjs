const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
// Execute the production auth functions and event listeners with a small DOM
// and mocked Supabase. These tests never create accounts or send real emails.
const functions = source.slice(source.indexOf('function openAuth(){'), source.indexOf('async function refreshAuthUI(){'));
const listeners = source.slice(source.indexOf('$("authForm").addEventListener("submit"'), source.indexOf('$("signOutBtn").addEventListener("click"'));

function setup(overrides = {}) {
  const elements = new Map();
  let now = 100000;
  let nextTimer = 0;
  const intervals = new Map();
  const timeouts = new Map();
  const document = { activeElement: null, body: { classList: { add() {}, remove() {} } } };
  for (const tag of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const attrs = new Map([...tag[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(x => [x[1], x[2]]));
    const classes = new Set((attrs.get('class') || '').split(/\s+/).filter(Boolean));
    const events = new Map();
    const element = {
      value: '', textContent: '', disabled: false, scrollTop: 200,
      classList: {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name),
        toggle(name, force = !classes.has(name)) { force ? classes.add(name) : classes.delete(name); return force; },
      },
      get className() { return [...classes].join(' '); },
      set className(value) { classes.clear(); value.split(/\s+/).filter(Boolean).forEach(name => classes.add(name)); },
      setAttribute: (name, value) => attrs.set(name, value),
      removeAttribute: name => attrs.delete(name),
      getAttribute: name => attrs.get(name),
      addEventListener: (event, handler) => events.set(event, handler),
      emit: async event => events.get(event)?.({ preventDefault() {} }),
      focus() { document.activeElement = element; },
      select() { element.selected = true; },
      querySelector: () => elements.get('authCard'),
    };
    elements.set(tag[1], element);
  }
  elements.set('authCard', { scrollTop: 200 });
  const calls = { signup: [], signin: [], resend: [] };
  const auth = {};
  for (const [method, key, response] of [
    ['signUp', 'signup', { data: { session: null }, error: null }],
    ['signInWithPassword', 'signin', { data: { session: { user: {} } }, error: null }],
    ['resend', 'resend', { error: null }],
  ]) {
    auth[method] = async input => { calls[key].push(input); return overrides[method] ? overrides[method](input) : response; };
  }
  const context = vm.createContext({
    document, $: id => elements.get(id), sb: { auth }, authModal: elements.get('authModal'),
    location: { origin: 'https://example.test', pathname: '/romuel-app-store/', search: '?app=demo', hash: '#ignore' },
    Date: { now: () => now }, refreshAuthUI() {},
    setTimeout: callback => { timeouts.set(++nextTimer, callback); return nextTimer; },
    setInterval: callback => { intervals.set(++nextTimer, callback); return nextTimer; },
    clearInterval: id => intervals.delete(id),
  });
  vm.runInContext('let authMode="signin",authBusy=false,confirmationResendBusy=false,confirmationResendAt=0,confirmationTimer=null,lastUnconfirmedEmail="";', context);
  vm.runInContext(functions + '\n' + listeners, context, { filename: 'production-auth.js' });
  context.openAuth();
  return {
    context, calls, elements, intervals,
    el: id => elements.get(id),
    run: code => vm.runInContext(code, context),
    async submit(mode = 'signup', email = 'test@gmail.com') {
      context.setAuthMode(mode);
      elements.get('authEmail').value = email;
      elements.get('authPassword').value = 'test-password';
      await elements.get('authForm').emit('submit');
    },
    advance(ms) { now += ms; [...intervals.values()].forEach(callback => callback()); },
    flushTimeouts() { [...timeouts.values()].forEach(callback => callback()); timeouts.clear(); },
  };
}

test('signup without a session replaces the form with focused confirmation instructions', async () => {
  const app = setup();
  await app.submit();
  assert.equal(app.el('emailConfirmation').classList.contains('hidden'), false);
  assert.equal(app.el('authEntry').classList.contains('hidden'), true);
  assert.equal(app.el('confirmationEmail').textContent, 'test@gmail.com');
  assert.equal(app.el('authTitle').textContent, 'Vérifie ta boîte e-mail');
  assert.equal(app.context.document.activeElement, app.el('authTitle'));
  assert.equal(app.el('authCard').scrollTop, 0);
  assert.equal(app.el('authPassword').value, '');
  assert.equal(app.el('resendConfirmBtn').disabled, true);
  assert.match(app.el('confirmResendHint').textContent, /60 s/);
  assert.equal(app.el('openMailboxLink').href, 'https://mail.google.com/');
  assert.equal(app.calls.signup[0].options.emailRedirectTo, 'https://example.test/romuel-app-store/');
});

test('resend waits 60 seconds, uses the signup address, and keeps the subdirectory redirect', async () => {
  const app = setup();
  await app.submit();
  await app.el('resendConfirmBtn').emit('click');
  assert.equal(app.calls.resend.length, 0);
  app.advance(60000);
  assert.equal(app.el('resendConfirmBtn').disabled, false);
  app.el('authEmail').value = 'someone-else@example.test';
  await app.el('resendConfirmBtn').emit('click');
  assert.equal(app.calls.resend[0].email, 'test@gmail.com');
  assert.equal(app.calls.resend[0].type, 'signup');
  assert.equal(app.calls.resend[0].options.emailRedirectTo, app.calls.signup[0].options.emailRedirectTo);
  assert.equal(app.el('resendConfirmBtn').disabled, true);
  assert.match(app.el('confirmationMessage').textContent, /lien le plus récent/);
});

for (const error of [
  { code: 'email_not_confirmed', message: 'Localized error' },
  { message: 'Email not confirmed' },
]) {
  test('unconfirmed signin offers confirmation help and resend: ' + (error.code || 'legacy message'), async () => {
    const app = setup({ signInWithPassword: () => ({ error }) });
    await app.submit('signin', 'test@outlook.fr');
    assert.equal(app.el('emailConfirmation').classList.contains('hidden'), false);
    assert.equal(app.el('resendConfirmBtn').disabled, false);
    assert.equal(app.el('openMailboxLink').href, 'https://outlook.live.com/mail/');
    assert.equal(app.calls.signup.length, 0);
  });
}

test('failed credentials stay on the login form', async () => {
  const app = setup({ signInWithPassword: () => ({ error: { message: 'Invalid login credentials' } }) });
  await app.submit('signin');
  assert.equal(app.el('emailConfirmation').classList.contains('hidden'), true);
  assert.equal(app.el('authMessage').textContent, 'Invalid login credentials');
  assert.equal(app.el('authSubmitBtn').disabled, false);
});

for (const mode of ['signin', 'signup']) {
  test(mode + ' with a session retains the normal successful login flow', async () => {
    const app = setup({ signUp: () => ({ data: { session: { user: {} } }, error: null }) });
    await app.submit(mode);
    assert.equal(app.el('emailConfirmation').classList.contains('hidden'), true);
    assert.equal(app.el('authMessage').textContent, 'Connexion réussie.');
    app.flushTimeouts();
    assert.equal(app.el('authModal').classList.contains('show'), false);
  });
}

test('duplicate submits are ignored and mode switches stay disabled during a request', async () => {
  let resolve;
  const app = setup({ signUp: () => new Promise(done => { resolve = done; }) });
  const pending = app.submit();
  await app.el('authForm').emit('submit');
  app.context.setAuthMode('signin');
  assert.equal(app.calls.signup.length, 1);
  assert.equal(app.run('authMode'), 'signup');
  assert.equal(app.el('signInTab').disabled, true);
  resolve({ data: { session: null }, error: null });
  await pending;
  assert.equal(app.el('signInTab').disabled, false);
  assert.equal(app.el('authForm').getAttribute('aria-busy'), 'false');
});

test('network failure restores the form controls', async () => {
  const app = setup({ signUp: () => { throw new TypeError('Failed to fetch'); } });
  await app.submit();
  assert.equal(app.el('authSubmitBtn').disabled, false);
  assert.equal(app.el('emailConfirmation').classList.contains('hidden'), true);
  assert.match(app.el('authMessage').textContent, /connexion Internet/);
});

test('failed resend stays on the confirmation screen and can be retried', async () => {
  const app = setup({ resend: () => { throw new Error('offline'); } });
  await app.submit();
  app.advance(60000);
  await app.el('resendConfirmBtn').emit('click');
  assert.equal(app.el('emailConfirmation').classList.contains('hidden'), false);
  assert.equal(app.el('resendConfirmBtn').disabled, false);
  assert.match(app.el('confirmationMessage').textContent, /renvoi a échoué/);
  assert.equal(app.el('changeConfirmationEmailBtn').disabled, false);
});

test('server rate limiting is explained in French and starts a cooldown', async () => {
  const app = setup({ resend: () => ({ error: { status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' } }) });
  await app.submit();
  app.advance(60000);
  await app.el('resendConfirmBtn').emit('click');
  assert.match(app.el('confirmationMessage').textContent, /limite d’envoi/);
  assert.equal(app.el('resendConfirmBtn').disabled, true);
  assert.match(app.el('confirmResendHint').textContent, /60 s/);
});

test('signup rate limiting does not claim that an email was sent', async () => {
  const app = setup({ signUp: () => ({ error: { status: 429, message: 'email rate limit exceeded' } }) });
  await app.submit();
  assert.equal(app.el('emailConfirmation').classList.contains('hidden'), true);
  assert.match(app.el('authMessage').textContent, /limite d’envoi/);
});

test('confirmation navigation returns to login or lets the user correct the address', async () => {
  const app = setup();
  await app.submit();
  await app.el('confirmationSignInBtn').emit('click');
  assert.equal(app.run('authMode'), 'signin');
  assert.equal(app.el('authEmail').value, 'test@gmail.com');
  assert.equal(app.context.document.activeElement, app.el('authPassword'));
  await app.submit();
  await app.el('changeConfirmationEmailBtn').emit('click');
  assert.equal(app.run('authMode'), 'signup');
  assert.equal(app.el('authEmail').selected, true);
  assert.equal(app.el('emailConfirmation').classList.contains('hidden'), true);
});

for (const domain of ['custom.example', 'constructor', '__proto__']) {
test('unknown email providers never produce a mailbox URL from user input: ' + domain, async () => {
  const app = setup();
  await app.submit('signup', 'test@' + domain);
  assert.equal(app.el('openMailboxLink').classList.contains('hidden'), true);
  assert.equal(app.el('openMailboxLink').getAttribute('href'), undefined);
  assert.equal(app.el('confirmationEmail').textContent, 'test@' + domain);
});
}

test('closing and reopening stops and resumes the timer without resetting the cooldown', async () => {
  const app = setup();
  await app.submit();
  app.context.closeAuth();
  assert.equal(app.intervals.size, 0);
  app.advance(10000);
  app.context.openAuth();
  assert.match(app.el('confirmResendHint').textContent, /50 s/);
  assert.equal(app.intervals.size, 1);
});
