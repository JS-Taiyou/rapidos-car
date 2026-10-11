import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker, DayFlag, SelectionState, UI, type DayPickerProps } from 'react-day-picker';

import { cn } from '../../lib/utils';

// Calendar de shadcn/ui sobre react-day-picker. Locale y timeZone los fija
// quien lo usa (el negocio opera en America/Merida).
function Calendar({
  className,
  classNames,
  ...props
}: DayPickerProps) {
  return (
    <DayPicker
      className={cn('p-3', className)}
      classNames={{
        [UI.Root]: cn('w-fit select-none'),
        [UI.Chevron]: 'h-4 w-4',
        [UI.Day]: cn(
          'relative flex h-9 w-9 items-center justify-center p-0 text-center text-sm',
        ),
        [UI.DayButton]: cn(
          'inline-flex h-9 w-9 items-center justify-center rounded-md p-0 text-sm font-normal transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-selected:opacity-100',
        ),
        [UI.CaptionLabel]: 'flex items-center gap-1 text-sm font-medium',
        [UI.Dropdowns]: 'flex items-center gap-1',
        [UI.Footer]: 'mt-3 w-full',
        [UI.MonthGrid]: 'w-full border-collapse space-y-1',
        [UI.MonthCaption]: 'flex justify-center pt-1 relative items-center h-9',
        [UI.Month]: 'space-y-4',
        [UI.Months]: 'flex flex-col sm:flex-row gap-2',
        [UI.Nav]: 'space-x-1 flex items-center',
        [UI.NextMonthButton]: cn(
          'absolute right-0 rounded-md h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 flex items-center justify-center',
        ),
        [UI.PreviousMonthButton]: cn(
          'absolute left-0 rounded-md h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 flex items-center justify-center',
        ),
        [UI.Week]: 'flex mt-2',
        [UI.Weeks]: cn('flex flex-col'),
        [UI.Weekday]: 'text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]',
        [UI.Weekdays]: 'flex',
        [DayFlag.today]: 'bg-accent text-accent-foreground rounded-md',
        [DayFlag.outside]:
          'text-muted-foreground opacity-50 aria-selected:opacity-30',
        [DayFlag.disabled]: 'text-muted-foreground opacity-50',
        [DayFlag.hidden]: 'invisible',
        [SelectionState.selected]:
          'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground rounded-md',
        [SelectionState.range_start]: 'day-range-start rounded-l-md bg-accent',
        [SelectionState.range_end]: 'day-range-end rounded-r-md bg-accent',
        [SelectionState.range_middle]:
          'aria-selected:bg-accent aria-selected:text-accent-foreground',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => {
          if (orientation === 'left') return <ChevronLeft className="h-4 w-4" />;
          return <ChevronRight className="h-4 w-4" />;
        },
      }}
      {...props}
    />
  );
}

export { Calendar };
