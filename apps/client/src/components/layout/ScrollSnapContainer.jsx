import { useEffect, useState } from 'react';

export function ScrollSnapContainer({ sections, children }) {
  const [activeSection, setActiveSection] = useState(sections[0]?.id || '');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((first, second) => second.intersectionRatio - first.intersectionRatio)[0];

      if (visible) setActiveSection(visible.target.id);
    }, { threshold: [0.35, 0.6, 0.85] });

    sections.forEach((section) => {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, [sections]);

  return (
    <div className="scroll-snap-shell">
      <div className="scroll-snap-dots" aria-label="Navegación de presentación">
        {sections.map((section, index) => (
          <a
            key={section.id}
            className={activeSection === section.id ? 'active' : ''}
            href={`#${section.id}`}
            aria-label={`Ir a ${section.label}`}
            aria-current={activeSection === section.id ? 'step' : undefined}
          >
            <span>{String(index + 1).padStart(2, '0')}</span>
          </a>
        ))}
      </div>
      {children}
    </div>
  );
}

export function ScrollSnapSection({ id, children, className = '' }) {
  return <section id={id} className={`scroll-snap-section ${className}`}>{children}</section>;
}
