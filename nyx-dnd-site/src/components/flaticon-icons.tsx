import type { HTMLAttributes } from 'react';

export type FlaticonIconProps = Omit<HTMLAttributes<HTMLElement>, 'color'> & {
  /** UIcons size in CSS pixels (or any valid CSS font-size value). */
  size?: number | string;
  color?: string;
};

function createFlaticonIcon(name: string) {
  return function FlaticonIcon({ size, color, className, style, ...props }: FlaticonIconProps) {
    const iconStyle = {
      ...style,
      ...(size !== undefined ? { fontSize: typeof size === 'number' ? `${size}px` : size } : {}),
      ...(color ? { color } : {}),
    };

    return (
      <i
        {...props}
        className={['flaticon-icon', `fi-rr-${name}`, className].filter(Boolean).join(' ')}
        style={iconStyle}
        aria-hidden={props['aria-hidden'] ?? true}
      />
    );
  };
}

export const ArrowLeft = createFlaticonIcon('arrow-left');
export const ArrowUpRight = createFlaticonIcon('arrow-up-right');
export const CalendarDays = createFlaticonIcon('calendar-day');
export const Check = createFlaticonIcon('check');
export const AlertCircle = createFlaticonIcon('circle-exclamation');
export const ChevronLeft = createFlaticonIcon('angle-small-left');
export const ChevronRight = createFlaticonIcon('angle-small-right');
export const Clock3 = createFlaticonIcon('clock-three');
export const LogOut = createFlaticonIcon('sign-out-alt');
export const Menu = createFlaticonIcon('menu-burger');
export const Pencil = createFlaticonIcon('pencil');
export const Plus = createFlaticonIcon('add');
export const RefreshCw = createFlaticonIcon('refresh');
export const Save = createFlaticonIcon('disk');
export const Trash2 = createFlaticonIcon('trash');
export const Video = createFlaticonIcon('video-camera');
export const X = createFlaticonIcon('x');
