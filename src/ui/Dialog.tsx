'use client';

import type { ReactNode } from 'react';
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger,
  Heading,
  Modal,
  ModalOverlay,
} from 'react-aria-components';

/**
 * Modal dialog: focus is trapped and restored, Escape closes it, and the
 * rest of the page is hidden from assistive technology while it is open.
 */
export function Dialog({
  trigger,
  title,
  closeLabel,
  children,
}: {
  trigger: string;
  title: string;
  closeLabel: string;
  children: ReactNode;
}) {
  return (
    <DialogTrigger>
      <AriaButton className="inline-flex min-h-11 items-center rounded-md border border-primary bg-primary-light px-5 font-medium text-primary hover:bg-surface-secondary">
        {trigger}
      </AriaButton>
      <ModalOverlay
        isDismissable
        className="fixed inset-0 z-50 flex items-end justify-center bg-fg/40 p-4 sm:items-center"
      >
        <Modal className="w-full max-w-md rounded-lg bg-surface shadow-lg">
          <AriaDialog className="flex flex-col gap-4 p-6 outline-none">
            {({ close }) => (
              <>
                <Heading slot="title" className="text-lg font-semibold">
                  {title}
                </Heading>
                <div className="text-fg-secondary">{children}</div>
                <AriaButton
                  onPress={close}
                  className="self-end font-medium text-primary hover:underline"
                >
                  {closeLabel}
                </AriaButton>
              </>
            )}
          </AriaDialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}
