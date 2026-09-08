import { forwardRef } from "react";
import { Button, type ButtonProps } from "../vendor/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../vendor/components/ui/tooltip";
import { cn } from "../vendor/lib/utils";

export const ToolbarButton = forwardRef<
  HTMLButtonElement,
  ButtonProps & { label: string }
>(function ToolbarButton({ label, className, children, ...props }, ref) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            ref={ref}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            className={cn(
              "filetree-preview-icon-button size-6 rounded-sm p-0 text-muted-foreground [&_svg]:size-3.5 max-md:pointer-coarse:size-9 max-md:pointer-coarse:[&_svg]:size-5",
              className,
            )}
            {...props}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
