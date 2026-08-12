
const io = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('on');
    entry.target.querySelectorAll('.card,.chip,.cell,.topic').forEach((el, i) => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      el.animate(
        [{opacity:0,transform:'translateY(10px) scale(.985)'},{opacity:1,transform:'translateY(0) scale(1)'}],
        {duration:500,delay:Math.min(i*28,260),easing:'cubic-bezier(.2,.8,.2,1)',fill:'both'}
      );
    });
    io.unobserve(entry.target);
  });
},{threshold:.12});
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

const contactForm = document.querySelector('#contact-form');
if (contactForm) {
  contactForm.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(contactForm);
    const name = (data.get('name') || '').toString().trim();
    const email = (data.get('email') || '').toString().trim();
    const topic = (data.get('topic') || 'General').toString().trim();
    const message = (data.get('message') || '').toString().trim();
    const subject = encodeURIComponent(`Vane ${topic}${name ? ` from ${name}` : ''}`);
    const body = encodeURIComponent(
      `${message}\n\n${name ? `Name: ${name}\n` : ''}${email ? `Email: ${email}\n` : ''}Topic: ${topic}`
    );
    window.location.href = `mailto:contact@codearc.studio?subject=${subject}&body=${body}`;
  });
}
