import { useState } from "react";
import { AppProvider, useAppStore } from "@/store/appStore";
import { Sidebar, MobileNav } from "@/components/layout/Sidebar";
import { DomainAnalyseView } from "@/views/DomainAnalyseView";
import { HtmlAnalyseView } from "@/views/HtmlAnalyseView";
import { ErgebnisseView } from "@/views/ErgebnisseView";
import { FaqView } from "@/views/FaqView";
import { KontaktView } from "@/views/KontaktView";
import { EinstellungenView } from "@/views/EinstellungenView";
import { WelcomeView } from "@/views/WelcomeView";

function AppContent() {
  const { activeView, analysisId } = useAppStore();
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);

  const showWelcome =
    activeView === 1 && !analysisId && !welcomeDismissed;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {/* Mobile top bar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b md:hidden sticky top-0 bg-background z-10">
          <MobileNav />
          <span className="text-sm font-semibold text-foreground">GAIO Analyzer</span>
        </div>

        <div className="px-8 py-8 min-h-full">
          {activeView === 1 && showWelcome && (
            <WelcomeView onDismiss={() => setWelcomeDismissed(true)} />
          )}
          {activeView === 1 && !showWelcome && <DomainAnalyseView />}
          {activeView === 2 && <HtmlAnalyseView />}
          {activeView === 3 && <ErgebnisseView />}
          {activeView === 4 && <FaqView />}
          {activeView === 5 && <KontaktView />}
          {activeView === 6 && <EinstellungenView />}
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
