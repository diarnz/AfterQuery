import { useId, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  /**
   * When set, the button is inert but stays focusable so keyboard and screen
   * reader users can learn why. Every disabled control in the terminal says why.
   */
  disabledReason?: string | null
  children: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  disabledReason = null,
  className,
  onClick,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const reasonId = useId()
  const inert = disabledReason !== null
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (inert) {
      event.preventDefault()
      return
    }
    onClick?.(event)
  }
  return (
    <>
      <button
        {...rest}
        type={type}
        className={['btn', `btn-${variant}`, `btn-${size}`, className].filter(Boolean).join(' ')}
        aria-disabled={inert || undefined}
        aria-describedby={inert ? reasonId : rest['aria-describedby']}
        title={inert ? disabledReason : rest.title}
        onClick={handleClick}
      >
        {children}
      </button>
      {inert && (
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      )}
    </>
  )
}
