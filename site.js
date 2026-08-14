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

const scrollProgress = document.querySelector('.scroll-progress');

if (scrollProgress) {
  const updateScrollProgress = () => {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const progress = scrollable > 0 ? Math.min(Math.max(window.scrollY / scrollable, 0), 1) : 0;
    scrollProgress.style.transform = `scaleX(${progress})`;
  };

  updateScrollProgress();
  window.addEventListener('scroll', updateScrollProgress, { passive: true });
  window.addEventListener('resize', updateScrollProgress);
}

