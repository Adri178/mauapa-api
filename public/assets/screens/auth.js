import { auth, post } from '../api.js';
import { go, homeFor, session } from '../store.js';
import { esc, errorNotice, fill } from '../ui.js';

/**
 * Sign in and sign up on one screen.
 *
 * STAFF is absent from the role picker on purpose: staff accounts are created
 * by an owner from inside their shop, and letting anyone self-register into the
 * role would hand out authority over somebody else's working day.
 */
export function renderAuth(root, route) {
  const mode = route.name === 'daftar' ? 'register' : 'login';

  fill(
    root,
    `<div class="auth-wrap">
      <div class="auth-card">
        <a class="brand" href="/" style="justify-content:center;padding-bottom:4px">
          <i class="ph ph-scissors"></i> MauApa?
        </a>

        <div class="card stack">
          <div class="tabs">
            <button class="btn btn-secondary" data-mode="login" aria-selected="${mode === 'login'}">Masuk</button>
            <button class="btn btn-secondary" data-mode="register" aria-selected="${mode === 'register'}">Daftar</button>
          </div>

          <form class="stack" id="form" novalidate>
            ${mode === 'register' ? field('name', 'Nama', '<input class="input" id="name" autocomplete="name" required />') : ''}
            ${field('email', 'Email', '<input class="input" id="email" type="email" autocomplete="username" required />')}
            ${field('password', 'Password', `<input class="input" id="password" type="password"
              autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}"
              ${mode === 'register' ? 'minlength="8"' : ''} required />`)}
            ${
              mode === 'register'
                ? field(
                    'role',
                    'Daftar sebagai',
                    `<select class="select" id="role">
                       <option value="CUSTOMER">Pelanggan — memesan di usaha orang lain</option>
                       <option value="OWNER">Pemilik usaha — mengelola usahamu sendiri</option>
                     </select>`,
                  )
                : ''
            }
            <button class="btn btn-order btn-block" type="submit" id="submit">
              ${mode === 'register' ? 'Buat akun' : 'Masuk'}
            </button>
          </form>

          <div id="feedback"></div>
        </div>

        <p class="faint" style="text-align:center">
          ${
            mode === 'register'
              ? 'Kapster tidak mendaftar sendiri — akunnya dibuatkan pemilik usaha.'
              : 'Belum punya akun? Pilih Daftar di atas.'
          }
        </p>
      </div>
    </div>`,
  );

  root.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => go(button.dataset.mode === 'register' ? 'daftar' : 'masuk'));
  });

  const feedback = root.querySelector('#feedback');
  const submit = root.querySelector('#submit');

  root.querySelector('#form').addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    feedback.innerHTML = '';

    const payload = {
      email: root.querySelector('#email').value.trim(),
      password: root.querySelector('#password').value,
    };

    try {
      const result =
        mode === 'register'
          ? await post('/auth/register', {
              ...payload,
              name: root.querySelector('#name').value.trim(),
              role: root.querySelector('#role').value,
            })
          : await post('/auth/login', payload);

      auth.remember(result);
      session.user = result.user;
      go(homeFor(result.user));
    } catch (error) {
      feedback.innerHTML = errorNotice(error);
      submit.disabled = false;
    }
  });
}

const field = (id, label, control) =>
  `<div class="field"><label for="${esc(id)}">${esc(label)}</label>${control}</div>`;
