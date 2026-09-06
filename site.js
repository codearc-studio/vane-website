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
  let scrollable = 1;
  let framePending = false;

  const paintScrollProgress = () => {
    const progress = Math.min(Math.max(window.scrollY / scrollable, 0), 1);
    scrollProgress.style.transform = `scaleX(${progress})`;
    framePending = false;
  };

  const requestScrollProgressPaint = () => {
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(paintScrollProgress);
  };

  const measureScrollRange = () => {
    scrollable = Math.max(
      document.documentElement.scrollHeight - window.innerHeight,
      1
    );
    requestScrollProgressPaint();
  };

  measureScrollRange();
  window.addEventListener('scroll', requestScrollProgressPaint, { passive: true });
  window.addEventListener('resize', measureScrollRange, { passive: true });
  window.addEventListener('load', measureScrollRange, { once: true });
}
