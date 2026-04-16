import { AppProvider, useAppStore } from "@/store/appStore";
import { Sidebar } from "@/components/layout/Sidebar";
import { DomainAnalyseView } from "@/views/DomainAnalyseView";
import { HtmlAnalyseView } from "@/views/HtmlAnalyseView";
import { ErgebnisseView } from "@/views/ErgebnisseView";
import { FaqView } from "@/views/FaqView";
import { EinstellungenView } from "@/views/EinstellungenView";

function AppContent() {
  const { activeView } = useAppStore();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="px-8 py-8 min-h-full">
          {activeView === 1 && <DomainAnalyseView />}
          {activeView === 2 && <HtmlAnalyseView />}
          {activeView === 3 && <ErgebnisseView />}
          {activeView === 4 && <FaqView />}
          {activeView === 5 && <EinstellungenView />}
        </div>
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
