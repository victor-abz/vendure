import { cn } from '@/vdb/lib/utils.js';
import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog';

export {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogMedia,
    AlertDialogOverlay,
    AlertDialogPortal,
    AlertDialogTrigger,
} from '@vendure-io/ui/components/ui/alert-dialog';

// Override AlertDialogTitle to use the heading font (Public Sans)
export function AlertDialogTitle({
    className,
    ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
    return (
        <AlertDialogPrimitive.Title
            data-slot="alert-dialog-title"
            className={cn(
                'text-lg font-medium font-heading sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2',
                className,
            )}
            {...props}
        />
    );
}
