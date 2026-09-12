"use client"

import * as React from "react"
import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

/**
 * ResizablePanelGroup component styled for this UI kit.
 *
 * @example
 * ```tsx
 * <ResizablePanelGroup direction="horizontal" className="h-32 w-96 rounded-lg border">
 *       <ResizablePanel defaultSize={50}>
 *         <div className="flex h-full items-center justify-center text-sm">Left</div>
 *       </ResizablePanel>
 *       <ResizableHandle withHandle />
 *       <ResizablePanel defaultSize={50}>
 *         <div className="flex h-full items-center justify-center text-sm">Right</div>
 *       </ResizablePanel>
 *     </ResizablePanelGroup>
 * ```
 */
function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    />
  )
}

/**
 * ResizablePanel component styled for this UI kit.
 *
 * @example
 * ```tsx
 * <ResizablePanelGroup direction="horizontal" className="h-32 w-96 rounded-lg border">
 *       <ResizablePanel defaultSize={50}>
 *         <div className="flex h-full items-center justify-center text-sm">Left</div>
 *       </ResizablePanel>
 *       <ResizableHandle withHandle />
 *       <ResizablePanel defaultSize={50}>
 *         <div className="flex h-full items-center justify-center text-sm">Right</div>
 *       </ResizablePanel>
 *     </ResizablePanelGroup>
 * ```
 */
function ResizablePanel({
  ...props
}: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

/**
 * ResizableHandle component styled for this UI kit.
 *
 * @example
 * ```tsx
 * <ResizablePanelGroup direction="horizontal" className="h-32 w-96 rounded-lg border">
 *       <ResizablePanel defaultSize={50}>
 *         <div className="flex h-full items-center justify-center text-sm">Left</div>
 *       </ResizablePanel>
 *       <ResizableHandle withHandle />
 *       <ResizablePanel defaultSize={50}>
 *         <div className="flex h-full items-center justify-center text-sm">Right</div>
 *       </ResizablePanel>
 *     </ResizablePanelGroup>
 * ```
 */
function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "relative flex w-px items-center justify-center bg-border ring-offset-background after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="bg-border h-6 w-1 rounded-lg z-10 flex shrink-0" />
      )}
    </ResizablePrimitive.Separator>
  )
}
/**
 * Props for ResizablePanelGroup.
 *
 * @example
 * ```tsx
 * <ResizablePanelGroup direction="horizontal" className="h-32 w-96 rounded-lg border">
 *       <ResizablePanel defaultSize={50}>
 *         <div className="flex h-full items-center justify-center text-sm">Left</div>
 *       </ResizablePanel>
 *       <ResizableHandle withHandle />
 *       <ResizablePanel defaultSize={50}>
 *         <div className="flex h-full items-center justify-center text-sm">Right</div>
 *       </ResizablePanel>
 *     </ResizablePanelGroup>
 * ```
 */
export type ResizablePanelGroupProps = React.ComponentProps<typeof ResizablePanelGroup>

/**
 * Props for ResizablePanel.
 *
 * @example
 * ```tsx
 * <ResizablePanelGroup direction="horizontal" className="h-32 w-96 rounded-lg border">
 *       <ResizablePanel defaultSize={50}>
 *         <div className="flex h-full items-center justify-center text-sm">Left</div>
 *       </ResizablePanel>
 *       <ResizableHandle withHandle />
 *       <ResizablePanel defaultSize={50}>
 *         <div className="flex h-full items-center justify-center text-sm">Right</div>
 *       </ResizablePanel>
 *     </ResizablePanelGroup>
 * ```
 */
export type ResizablePanelProps = React.ComponentProps<typeof ResizablePanel>

/**
 * Props for ResizableHandle.
 *
 * @example
 * ```tsx
 * <ResizablePanelGroup direction="horizontal" className="h-32 w-96 rounded-lg border">
 *       <ResizablePanel defaultSize={50}>
 *         <div className="flex h-full items-center justify-center text-sm">Left</div>
 *       </ResizablePanel>
 *       <ResizableHandle withHandle />
 *       <ResizablePanel defaultSize={50}>
 *         <div className="flex h-full items-center justify-center text-sm">Right</div>
 *       </ResizablePanel>
 *     </ResizablePanelGroup>
 * ```
 */
export type ResizableHandleProps = React.ComponentProps<typeof ResizableHandle>


export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
