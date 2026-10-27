export function AppAnimations() {
  return (
    <style>{`
      @keyframes tooltip-appear {
        from {
          opacity: 0;
          transform: translateY(-50%) translateX(-5px);
        }
        to {
          opacity: 1;
          transform: translateY(-50%) translateX(0);
        }
      }
      @keyframes tooltip-disappear {
        from {
          opacity: 1;
          transform: translateY(-50%) translateX(0);
        }
        to {
          opacity: 0;
          transform: translateY(-50%) translateX(-3px);
        }
      }
      @keyframes dropdown-appear {
        from {
          opacity: 0;
          transform: translateY(-4px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
      @keyframes dropdown-disappear {
        from {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
        to {
          opacity: 0;
          transform: translateY(-4px) scale(0.98);
        }
      }
      @keyframes inner-glow {
        0%, 100% {
          box-shadow: inset 0 0 5px rgba(255,255,255,0.25);
        }
        50% {
          box-shadow: inset 0 0 16px rgba(255,255,255,0.6);
        }
      }
    `}</style>
  );
}
