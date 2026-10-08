export type RunDetectionButtonProps = {
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
};

export function RunDetectionButton({
  disabled,
  loading,
  onClick,
}: RunDetectionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-md bg-primary text-primary-foreground font-semibold py-2.5
        disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition"
    >
      {loading
        ? "Running YOLO… (check terminal for progress)"
        : "▶ Run Detection"}
    </button>
  );
}
