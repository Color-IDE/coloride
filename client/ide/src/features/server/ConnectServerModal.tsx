import { AnimatePresence, motion, type Variants } from "motion/react";
import { useEffect, useState } from "react";
import { ColorideMark, ColorideWordmark } from "../../shared/ui/ColorideBrand";
import type { ServerWorkspaceController } from "./useServerWorkspace";

export { ColorideMark, ColorideWordmark };

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 15 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring",
      stiffness: 300,
      damping: 24,
    },
  },
};

interface ConnectServerModalProps {
  workspace: ServerWorkspaceController;
  /** Fired when the user submits connect so App can open Explorer when ready. */
  onConnectIntent?: () => void;
}

export type ConnectServerFormProps = {
  workspace: ServerWorkspaceController;
  onConnectIntent?: () => void;
  /** Hide logo + large title (Welcome already has the wordmark). */
  compact?: boolean;
  /** Optional close control for inline Welcome panel. */
  onClose?: () => void;
};

/** Multi-step connect form body (server → credentials → host key). */
export function ConnectServerForm({
  workspace,
  onConnectIntent,
  compact = false,
  onClose,
}: ConnectServerFormProps) {
  const title = workspace.hostKeyPrompt
    ? "Verify server"
    : workspace.connectStep === "credentials"
      ? "Sign in"
      : "Connect a server";

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="connect-server-form relative w-full"
    >
      {onClose ? (
        <button
          onClick={onClose}
          className="connect-server-close absolute -right-1 -top-1 z-30 flex size-8 items-center justify-center rounded-lg text-[#878888] transition-colors hover:bg-white/[0.06] hover:text-[#f0f4f8]"
          aria-label="Close"
          type="button"
        >
          <CloseIcon />
        </button>
      ) : null}

      <motion.div variants={itemVariants} className={compact ? "mb-5 text-left" : "mb-7 text-left"}>
        {!compact ? (
          <div className="connect-server-mark mb-5 w-[148px] max-w-full text-[#f5f4f0]">
            <ColorideWordmark />
          </div>
        ) : null}
        <h2
          className={
            compact
              ? "text-[20px] leading-tight font-medium tracking-tight text-balance text-white"
              : "text-[28px] leading-tight font-medium tracking-tight text-balance text-white"
          }
        >
          {title}
        </h2>
      </motion.div>

      {workspace.hostKeyPrompt ? (
        <HostKeyVerification workspace={workspace} />
      ) : workspace.connectStep === "credentials" ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            onConnectIntent?.();
            return workspace.handleConnectSubmit(event);
          }}
        >
          <motion.div variants={itemVariants}>
            <TextField
              autoComplete="username"
              error={workspace.errors.username}
              id="username"
              name="username"
              onBlur={(value) => workspace.setUsername(value.trim())}
              onChange={(value) => {
                workspace.setUsername(value);
                workspace.clearErrors("username");
              }}
              placeholder="Username"
              testId="username-input"
              value={workspace.username}
            />
          </motion.div>

          <motion.div variants={itemVariants}>
            <CredentialField workspace={workspace} />
          </motion.div>

          {workspace.authMethod === "ssh-key" && (
            <motion.div variants={itemVariants}>
              <PasswordField
                error={workspace.errors.keyPassphrase}
                id="key-passphrase"
                name="keyPassphrase"
                onChange={(value) => {
                  workspace.setKeyPassphrase(value);
                  workspace.clearErrors("keyPassphrase");
                }}
                placeholder="Key Passphrase (optional)"
                showPassword={workspace.showPassword}
                testId="key-passphrase-input"
                togglePassword={() => workspace.setShowPassword(!workspace.showPassword)}
                value={workspace.keyPassphrase}
              />
            </motion.div>
          )}

          <motion.div variants={itemVariants} className="relative mt-1 flex gap-2">
            <ConnectErrorCloud error={workspace.errors.connect} />
            <button
              className="h-10 flex-1 rounded-2xl bg-[#333333] text-sm text-[#d1d5db] transition-all hover:bg-[#3b3b3b] active:scale-95"
              onClick={workspace.backToServerStep}
              type="button"
            >
              Back
            </button>
            <button
              type="submit"
              className="connect-server-submit flex h-10 flex-[1.4] items-center justify-center rounded-2xl bg-[#2c2c2c] text-sm font-medium text-[#f0f4f8] transition-colors hover:bg-[#383838] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
              disabled={workspace.connectionState === "connecting"}
            >
              {workspace.connectionState === "connecting" ? "Connecting…" : "Continue"}
            </button>
          </motion.div>

          <input
            ref={workspace.sshKeyFileInputRef}
            type="file"
            className="hidden"
            accept=".pem,.key,.ppk,application/x-pem-file"
            onChange={workspace.handleSshKeyFileChange}
          />
        </form>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={workspace.handleServerStepSubmit}>
          <motion.div variants={itemVariants}>
            <TextField
              error={workspace.errors.serverName}
              errorWrap
              id="server-name"
              name="serverName"
              onBlur={(value) => workspace.setServerName(value.trim())}
              onChange={(value) => {
                workspace.setServerName(value);
                workspace.clearErrors("serverName");
              }}
              placeholder="Server Name"
              testId="server-name-input"
              value={workspace.serverName}
            />
          </motion.div>

          <motion.div variants={itemVariants} className="flex gap-3">
            <div className="min-w-0 flex-1">
              <TextField
                error={workspace.errors.host}
                errorSide="left"
                errorWrap
                id="host"
                name="host"
                onBlur={(value) => workspace.setHost(value.trim())}
                onChange={(value) => {
                  workspace.setHost(value);
                  workspace.clearErrors("host");
                }}
                placeholder="IP address or hostname"
                testId="host-input"
                value={workspace.host}
              />
            </div>
            <div className="w-[4.5rem] shrink-0">
              <TextField
                error={workspace.errors.port}
                errorSide="right"
                errorWrap
                id="port"
                name="port"
                onChange={(value) => {
                  // Digits only — avoid native number min/max browser bubbles.
                  const digits = value.replace(/\D/g, "").slice(0, 5);
                  workspace.setPort(digits);
                  workspace.clearErrors("port");
                }}
                placeholder="22"
                testId="port-input"
                inputMode="numeric"
                value={workspace.port}
              />
            </div>
          </motion.div>

          <motion.div variants={itemVariants} className="mt-1">
            <button
              type="submit"
              className="connect-server-submit flex h-10 w-full items-center justify-center rounded-2xl bg-[#2c2c2c] text-sm font-medium text-[#f0f4f8] transition-colors hover:bg-[#383838] active:scale-[0.98]"
            >
              Continue
            </button>
          </motion.div>
        </form>
      )}
    </motion.div>
  );
}

export function ConnectServerModal({ workspace, onConnectIntent }: ConnectServerModalProps) {
  const [rendered, setRendered] = useState(workspace.showConnectModal);

  useEffect(() => {
    if (workspace.showConnectModal) {
      setRendered(true);
    }
  }, [workspace.showConnectModal]);

  const closeModal = () => {
    workspace.cancelHostKeyPrompt();
    workspace.setShowConnectModal(false);
  };

  if (!rendered) return null;

  return (
    <AnimatePresence onExitComplete={() => setRendered(false)}>
      {workspace.showConnectModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45"
          onClick={closeModal}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 14 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className="connect-server-modal relative mx-4 flex max-h-[calc(100vh-32px)] w-full max-w-[520px] overflow-hidden rounded-[22px] border border-[#323232] bg-[#212121] text-neutral-200 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              onClick={closeModal}
              className="connect-server-close absolute right-4 top-4 z-30 flex size-8 items-center justify-center rounded-lg text-[#878888] transition-colors hover:bg-white/[0.06] hover:text-[#f0f4f8]"
              aria-label="Close"
              type="button"
            >
              <CloseIcon />
            </button>
            <div className="flex w-full flex-col items-center justify-center overflow-auto px-6 py-8 sm:px-14 sm:py-12">
              <div className="w-full max-w-[400px]">
                <ConnectServerForm onConnectIntent={onConnectIntent} workspace={workspace} />
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function HostKeyVerification({ workspace }: { workspace: ServerWorkspaceController }) {
  const key = workspace.hostKeyPrompt;
  if (!key) return null;
  const changed = key.status === "changed";

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-4">
      <motion.div variants={itemVariants} className={`rounded-2xl border p-4 ${changed ? "border-[#63343b] bg-[#2a1d20]" : "border-[#3b3b3b] bg-[#292929]"}`}>
        <div className={`text-sm font-medium ${changed ? "text-[#ff8996]" : "text-[#f0f4f8]"}`}>
          {changed ? "Server identity changed" : "First connection to this server"}
        </div>
        <p className="mt-1.5 text-xs leading-5 text-[#a6a6ad]">
          {changed
            ? "Coloride blocked the connection because this server is presenting a different SSH key. Only continue if you reinstalled or intentionally changed the VPS."
            : "Confirm this SHA-256 fingerprint against the value shown by your VPS provider before trusting it."}
        </p>
      </motion.div>

      <motion.div variants={itemVariants} className="space-y-3 rounded-2xl bg-[#171717] p-4">
        <div>
          <div className="text-[10px] uppercase text-[#6f6f6f]">Server</div>
          <div className="mt-1 text-sm text-[#d1d5db]">{key.host}:{key.port}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-[#6f6f6f]">Algorithm</div>
          <div className="mt-1 font-mono text-xs text-[#d1d5db]">{key.algorithm}</div>
        </div>
        {changed && key.trustedFingerprint && (
          <div>
            <div className="text-[10px] uppercase text-[#6f6f6f]">Previous fingerprint</div>
            <div className="mt-1 break-all font-mono text-[11px] leading-5 text-[#878888]">{key.trustedFingerprint}</div>
          </div>
        )}
        <div>
          <div className="text-[10px] uppercase text-[#6f6f6f]">{changed ? "New fingerprint" : "Fingerprint"}</div>
          <div className="mt-1 break-all font-mono text-[11px] leading-5 text-[#f0f4f8]">{key.fingerprint}</div>
        </div>
      </motion.div>

      <motion.div variants={itemVariants} className="relative flex gap-2">
        <ConnectErrorCloud error={workspace.errors.connect} />
        <button className="h-10 flex-1 rounded-2xl bg-[#333333] text-sm text-[#d1d5db] transition-all hover:bg-[#3b3b3b] active:scale-95" onClick={workspace.cancelHostKeyPrompt} type="button">
          Cancel
        </button>
        <button className={`h-10 flex-1 rounded-2xl text-sm font-medium transition-all active:scale-95 disabled:opacity-60 ${changed ? "bg-[#f15b6c] text-white" : "bg-[var(--accent-color)] text-black"}`} disabled={workspace.hostKeyTrusting} onClick={() => void workspace.trustPendingHostKey()} type="button">
          {workspace.hostKeyTrusting ? "Checking..." : changed ? "Replace and continue" : "Trust and continue"}
        </button>
      </motion.div>
    </motion.div>
  );
}

function TextField({
  autoComplete = "off",
  disabled = false,
  error,
  errorSide = "right",
  errorWrap = false,
  id,
  inputMode,
  name,
  onBlur,
  onChange,
  placeholder,
  testId,
  type = "text",
  value,
}: {
  autoComplete?: string;
  disabled?: boolean;
  error?: string;
  errorSide?: "left" | "right";
  errorWrap?: boolean;
  id: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  name: string;
  onBlur?: (value: string) => void;
  onChange: (value: string) => void;
  placeholder: string;
  testId: string;
  type?: string;
  value: string;
}) {
  return (
    <div className="relative w-full">
      <input
        autoComplete={autoComplete}
        data-1p-ignore="true"
        data-bwignore="true"
        data-form-type="other"
        data-lpignore="true"
        className={`${inputClass(error)}${disabled ? " connect-server-input-locked" : ""}`}
        data-testid={testId}
        disabled={disabled}
        id={id}
        inputMode={inputMode}
        name={name}
        onBlur={(event) => {
          if (disabled) return;
          onBlur?.(event.target.value);
        }}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        readOnly={disabled}
        type={type}
        value={value}
        aria-invalid={Boolean(error) || undefined}
      />
      <FieldError error={error} side={errorSide} wrap={errorWrap} />
    </div>
  );
}

function CredentialField({ workspace }: { workspace: ServerWorkspaceController }) {
  return (
    <div className="flex items-start gap-2 w-full">
      <div className="relative min-w-0 flex-1">
        {workspace.authMethod === "ssh-key" ? (
          <div className="relative w-full">
            <button
              type="button"
              onClick={workspace.selectSshKeyFile}
              title={workspace.sshKeyPath || undefined}
              className="flex h-[40px] w-full items-center gap-2 rounded-2xl bg-[#3c3c3c] px-3 text-base text-[#acadae] transition-colors hover:bg-[#454545] active:bg-[#383838] focus-visible:outline-none"
            >
              <FileKeyIcon />
              <span className="truncate text-left">
                {workspace.sshKeyPath
                  ? workspace.sshKeyPath.replace(/^\[selected\] /, "")
                  : "Select private key file..."}
              </span>
            </button>
            <FieldError error={workspace.errors.sshKey} side="left" wrap />
          </div>
        ) : (
          <PasswordField
            disabled={workspace.authMethod === "ssh-agent"}
            error={workspace.authMethod === "password" ? workspace.errors.password : undefined}
            errorSide="left"
            errorWrap
            id="credential"
            name="credential"
            onChange={(value) => {
              if (workspace.authMethod === "password") {
                workspace.setPassword(value);
                workspace.clearErrors("password");
              }
            }}
            placeholder={workspace.authMethod === "password" ? "Password" : "SSH Agent"}
            showPassword={workspace.showPassword}
            testId="credential-input"
            togglePassword={() => workspace.setShowPassword(!workspace.showPassword)}
            value={workspace.authMethod === "password" ? workspace.password : ""}
          />
        )}
      </div>

      <AuthMethodDropdown workspace={workspace} />
    </div>
  );
}

function AuthMethodDropdown({ workspace }: { workspace: ServerWorkspaceController }) {
  const selectMethod = (method: ServerWorkspaceController["authMethod"]) => {
    workspace.setAuthMethod(method);
    workspace.setShowKeyDropdown(false);
    if (method === "ssh-key" && !workspace.sshKeyPath) {
      setTimeout(() => workspace.selectSshKeyFile(), 50);
    }
  };

  return (
    <div className="relative" ref={workspace.keyDropdownRef}>
      <button
        type="button"
        onClick={() => workspace.setShowKeyDropdown(!workspace.showKeyDropdown)}
        className="flex h-[40px] items-center gap-1.5 rounded-2xl bg-[#3c3c3c] pl-4 pr-3 text-sm text-[#acadae] transition-colors hover:bg-[#2a2a2a] hover:text-white active:bg-[#252525]"
      >
        {workspace.authMethod === "password"
          ? "Password"
          : workspace.authMethod === "ssh-key"
            ? "SSH Key"
            : "SSH Agent"}
        <ChevronDownIcon />
      </button>

      {workspace.showKeyDropdown && (
        <div className="absolute right-0 top-full z-[100] mt-2 w-44 rounded-2xl border border-[#323232] bg-[#212121] p-1.5 shadow-md">
          <AuthMethodOption
            active={workspace.authMethod === "password"}
            label="Password"
            onSelect={() => selectMethod("password")}
          />
          <AuthMethodOption
            active={workspace.authMethod === "ssh-key"}
            label="SSH Key"
            onSelect={() => selectMethod("ssh-key")}
          />
          <AuthMethodOption
            active={workspace.authMethod === "ssh-agent"}
            label="SSH Agent"
            onSelect={() => selectMethod("ssh-agent")}
          />
        </div>
      )}
    </div>
  );
}

function AuthMethodOption({
  active,
  label,
  onSelect,
}: {
  active: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={`flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-sm hover:bg-[#2a2a2a] ${active ? "text-white" : "text-[#c5c3bf]"
        }`}
    >
      {label}
      {active && <CheckIcon />}
    </div>
  );
}

function PasswordField({
  disabled = false,
  error,
  errorSide = "left",
  errorWrap = true,
  id,
  name,
  onChange,
  placeholder,
  showPassword,
  testId,
  togglePassword,
  value,
}: {
  disabled?: boolean;
  error?: string;
  errorSide?: "left" | "right";
  errorWrap?: boolean;
  id: string;
  name: string;
  onChange: (value: string) => void;
  placeholder: string;
  showPassword: boolean;
  testId: string;
  togglePassword: () => void;
  value: string;
}) {
  return (
    <div className="relative w-full">
      <div className="relative">
        <input
          autoComplete={name === "credential" ? "current-password" : "off"}
          data-1p-ignore="true"
          data-bwignore="true"
          data-form-type="other"
          data-lpignore="true"
          className={`${inputClass(error)} pr-10`}
          data-testid={testId}
          disabled={disabled}
          id={id}
          name={name}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          type={showPassword ? "text" : "password"}
          value={value}
          aria-invalid={Boolean(error) || undefined}
        />
        {!disabled && (
          <button
            type="button"
            onClick={togglePassword}
            className="group absolute right-3 top-1/2 -translate-y-1/2 transition-colors flex items-center justify-center cursor-pointer"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeClosedIcon /> : <EyeOpenIcon />}
          </button>
        )}
      </div>
      <FieldError error={error} side={errorSide} wrap={errorWrap} />
    </div>
  );
}

/** Map backend/SSH noise into short 2-line cloud copy. */
function friendlyConnectError(raw: string): string {
  const t = raw.toLowerCase();
  if (
    t.includes("nodename nor servname") ||
    t.includes("name or service not known") ||
    t.includes("errno 8") ||
    t.includes("getaddrinfo") ||
    t.includes("temporary failure in name resolution")
  ) {
    return "Host not found.\nCheck the IP or hostname.";
  }
  if (t.includes("connection refused")) {
    return "Connection refused.\nCheck port and SSH service.";
  }
  if (t.includes("timed out") || t.includes("timeout") || t.includes("no route to host")) {
    return "Connection timed out.\nCheck IP, port, and firewall.";
  }
  if (
    t.includes("authentication failed") ||
    t.includes("permission denied") ||
    t.includes("auth fail")
  ) {
    return "Authentication failed.\nCheck password or SSH key.";
  }
  if (t.includes("unable to read the ssh identity")) {
    return "Could not reach the host.\nCheck IP, hostname, and port.";
  }
  // Keep short enough for the cloud; preserve newlines if present.
  const trimmed = raw.trim();
  if (trimmed.length <= 90) return trimmed;
  return `${trimmed.slice(0, 84).trim()}…`;
}

/** Form-level connect error — red cloud to the left of the button row. */
function ConnectErrorCloud({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <FieldError error={friendlyConnectError(error)} side="left" wrap />
  );
}

/** Red cloud error tip — same language as PrimaryRail tooltips (side pin). */
function FieldError({
  error,
  side = "right",
  wrap = false,
}: {
  error?: string;
  /** Which side of the input the cloud sits on (pin always faces the field). */
  side?: "left" | "right";
  /** Allow the label to wrap (up to ~2 lines). */
  wrap?: boolean;
}) {
  if (!error) return null;
  // Pin sits between the field and the label.
  const pin = <span className="connect-field-error-cloud-pin" aria-hidden="true" />;
  const label = (
    <span
      className={`connect-field-error-cloud-label${wrap ? " connect-field-error-cloud-label--wrap" : ""}`}
    >
      {error}
    </span>
  );
  return (
    <div
      className={`connect-field-error-cloud connect-field-error-cloud--${side}`}
      role="alert"
    >
      {side === "right" ? (
        <>
          {pin}
          {label}
        </>
      ) : (
        <>
          {label}
          {pin}
        </>
      )}
    </div>
  );
}

function inputClass(error?: string) {
  return `flex h-[40px] w-full rounded-2xl bg-[#3c3c3c] px-3 py-2 text-base text-[#acadae] ring-offset-background file:border-0 file:bg-transparent file:text-base file:font-medium placeholder:text-[#878888] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${error ? "text-[#f4a1aa] placeholder:text-[#e88390]" : ""
    }`;
}

function FileKeyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[#878888]" aria-hidden="true">
      <path d="M13 2.5V3c0 2.83 0 4.25.88 5.13C14.76 9 16.17 9 19 9h.5" />
      <path d="M4 8c.02-2.3.14-3.59.88-4.51C5.06 3.27 5.26 3.07 5.49 2.89 6.59 2 8.21 2 11.45 2c.71 0 1.06 0 1.39.11.31.15.56.4 1.06.9l4.93 4.94c.58.58.87.87 1.02 1.24.15.37.15.78.15 1.6V14c0 3.78 0 5.66-1.17 6.84-.94.94-2.35 1.12-4.83 1.16" />
      <circle cx="7" cy="14" r="3" />
      <path d="m5 16.5-.87 4.77c-.07.38.22.73.61.73.16 0 .32-.07.44-.18L7 20l1.82 1.82c.12.11.28.18.44.18.39 0 .68-.35.61-.73L9 16.5" />
    </svg>
  );
}

function EyeOpenIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[#878888] group-hover:text-[#acadae]" aria-hidden="true">
      <path d="M21.544 11.045C21.848 11.4713 22 11.6845 22 12C22 12.3155 21.848 12.5287 21.544 12.955C20.1779 14.8706 16.6892 19 12 19C7.31078 19 3.8221 14.8706 2.45604 12.955C2.15201 12.5287 2 12.3155 2 12C2 11.6845 2.15201 11.4713 2.45604 11.045C3.8221 9.12944 7.31078 5 12 5C16.6892 5 20.1779 9.12944 21.544 11.045Z" />
      <path d="M15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15C13.6569 15 15 13.6569 15 12Z" />
    </svg>
  );
}

function EyeClosedIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#878888] group-hover:text-[#acadae]" aria-hidden="true">
      <path d="M22 8c-2.2 3.02-5.86 5-10 5S4.2 11.02 2 8" />
      <path d="m15 13 1.5 3" />
      <path d="m20 11 2 2.5" />
      <path d="m2 13.5 2-2.5" />
      <path d="m9 13-1.5 3" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="opacity-70" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
