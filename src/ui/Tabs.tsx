'use client';

import type { ReactNode } from 'react';
import { Tab, TabList, TabPanel, Tabs as AriaTabs } from 'react-aria-components';

/** Accessible tabs: arrow keys move between tabs (mirrored in RTL). */
export function Tabs({
  label,
  tabs,
}: {
  label: string;
  tabs: { id: string; title: string; content: ReactNode }[];
}) {
  return (
    <AriaTabs className="flex flex-col gap-4">
      <TabList aria-label={label} className="flex gap-1 border-b border-border">
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            id={tab.id}
            className="-mb-px cursor-pointer border-b-2 border-transparent px-3 py-2 font-medium text-fg-secondary outline-none hover:text-fg data-[focus-visible]:outline-2 data-[focus-visible]:outline-focus data-[selected]:border-primary data-[selected]:text-primary"
          >
            {tab.title}
          </Tab>
        ))}
      </TabList>
      {tabs.map((tab) => (
        <TabPanel key={tab.id} id={tab.id}>
          {tab.content}
        </TabPanel>
      ))}
    </AriaTabs>
  );
}
