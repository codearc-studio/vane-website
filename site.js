const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const reveal = document.querySelectorAll('.reveal');

if (reduce) {
  reveal.forEach(el => el.classList.add('on'));
} else {
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('on');
      io.unobserve(entry.target);
    });
  }, { threshold: .1 });
  reveal.forEach(el => io.observe(el));
}
