export function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={`settings-toggle group relative h-5 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-[#4cae77]" : "bg-[#474747]"}`}
      data-checked={checked}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      role="switch"
      type="button"
    >
      <span
        className={`absolute top-0.5 h-4 w-6 rounded-full bg-white transition-[left,transform] duration-200 ease-out group-active:scale-x-110 ${checked ? "left-[18px] origin-right" : "left-0.5 origin-left"}`}
      />
    </button>
  );
}
