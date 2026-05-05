import { cn } from '@/vdb/lib/utils.js';
import { DialogPrimitive } from '@vendure-io/ui/lib/base-ui';

export {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogOverlay,
    DialogPortal,
    DialogTrigger,
} from '@vendure-io/ui/components/ui/dialog';

// Override DialogTitle to use the heading font (Public Sans)
export function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
    return (
        <DialogPrimitive.Title
            data-slot="dialog-title"
            className={cn('leading-none font-medium font-heading', className)}
            {...props}
        />
    );
}
