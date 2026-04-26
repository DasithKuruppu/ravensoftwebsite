// ── Config ───────────────────────────────────────────────────────────────────
// After first `cdk deploy`, replace this with the ApiEndpoint output value.
// e.g. 'https://abc123.execute-api.us-east-1.amazonaws.com'
const CONTACT_API_URL = 'REPLACE_WITH_CDK_API_ENDPOINT';

// ── Nav — highlight active section on scroll ─────────────────────────────────
const sections  = document.querySelectorAll('section[id]');
const navLinks  = document.querySelectorAll('.nav__links a');

const navObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        navLinks.forEach((link) => {
          link.classList.toggle(
            'active',
            link.getAttribute('href') === `#${entry.target.id}`
          );
        });
      }
    });
  },
  { rootMargin: '-40% 0px -55% 0px' }
);
sections.forEach((s) => navObserver.observe(s));

// ── Contact form — POST to API Gateway → Lambda → DynamoDB ───────────────────
const form = document.querySelector('.contact__form');
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const btn     = form.querySelector('button[type="submit"]');
    const status  = document.getElementById('form-status');

    btn.textContent = 'Sending…';
    btn.disabled    = true;
    if (status) status.textContent = '';

    const payload = {
      name:    form.name.value.trim(),
      email:   form.email.value.trim(),
      message: form.message.value.trim(),
    };

    try {
      const res = await fetch(`${CONTACT_API_URL}/contact`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Server error ${res.status}`);
      }

      form.reset();
      if (status) {
        status.textContent = 'Message sent! We\'ll be in touch soon.';
        status.className   = 'form-status form-status--ok';
      }
    } catch (err) {
      if (status) {
        status.textContent = `Something went wrong: ${err.message}`;
        status.className   = 'form-status form-status--err';
      }
    } finally {
      btn.textContent = 'Send Message';
      btn.disabled    = false;
    }
  });
}
