import { useState } from "react";
import { AppProvider, useAppStore } from "@/store/appStore";
import { AuthProvider, useAuth } from "@/store/authStore";
import { Sidebar, MobileNav } from "@/components/layout/Sidebar";
import { DomainAnalyseView } from "@/views/DomainAnalyseView";
import { HtmlAnalyseView } from "@/views/HtmlAnalyseView";
import { ErgebnisseView } from "@/views/ErgebnisseView";
import { FaqView } from "@/views/FaqView";
import { KontaktView } from "@/views/KontaktView";
import { EinstellungenView } from "@/views/EinstellungenView";
import { WelcomeView } from "@/views/WelcomeView";
import { LoginView } from "@/views/admin/LoginView";
import { ForcePasswordChangeView } from "@/views/admin/ForcePasswordChangeView";
import { ProfileView } from "@/views/admin/ProfileView";
import { UserManagementView } from "@/views/admin/UserManagementView";
import { AnalysisLogView } from "@/views/admin/AnalysisLogView";
import { AiToolView } from "@/views/admin/AiToolView";
import { MailserverView } from "@/views/admin/MailserverView";
import { DeliveryView } from "@/views/admin/DeliveryView";

function AppContent() {
  const { activeView, analysisId } = useAppStore();
  const { isAuthenticated, pendingChangeUsername } = useAuth();
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);

  const showWelcome = activeView === 1 && !analysisId && !welcomeDismissed;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b md:hidden sticky top-0 bg-background z-10">
          <MobileNav />
          <span className="text-sm font-semibold text-foreground">GAIO Analyzer</span>
        </div>

        <main className="flex-1 overflow-y-auto">
          <div className="px-8 py-8 min-h-full">
            {/* Force-password-change intercept: shown until the user sets a real password */}
            {pendingChangeUsername ? (
              <ForcePasswordChangeView />
            ) : (
              <>
                {activeView === 1 && showWelcome    && <WelcomeView onDismiss={() => setWelcomeDismissed(true)} />}
                {activeView === 1 && !showWelcome   && <DomainAnalyseView />}
                {activeView === 2                   && <HtmlAnalyseView />}
                {activeView === 3                   && <ErgebnisseView />}
                {activeView === 4                   && <FaqView />}
                {activeView === 5                   && <KontaktView />}
                {activeView === 6                   && <EinstellungenView />}
                {activeView === 7                   && (isAuthenticated ? <ProfileView /> : <LoginView />)}
                {activeView === 8                   && <UserManagementView />}
                {activeView === 9                   && <AnalysisLogView />}
                {activeView === 10                  && <AiToolView />}
                {activeView === 11                  && <MailserverView />}
                {activeView === 12                  && <DeliveryView />}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <AuthProvider>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </AuthProvider>
  );
}
