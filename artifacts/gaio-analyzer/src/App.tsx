import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import { SharedAnalysisView } from "@/views/SharedAnalysisView";
import { DeliveryModeProvider } from "@/store/deliveryModeStore";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/share/:token" component={SharedAnalysisView} />
      <Route path="/" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <DeliveryModeProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </DeliveryModeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
