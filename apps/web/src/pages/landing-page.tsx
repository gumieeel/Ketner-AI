import { useEffect } from 'react';
import { LandingFaq } from './landing/faq';
import { LandingFinalCta } from './landing/final-cta';
import { LandingHero } from './landing/hero';
import { LandingModels } from './landing/models';
import { LandingPricingSection } from './landing/pricing-section';
import { LandingProviders } from './landing/providers';
import { LandingSavings } from './landing/savings';
import { LandingWorkspaces } from './landing/workspaces';

export function LandingPage() {
  useEffect(() => {
    if (!window.location.hash) {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  }, []);

  return (
    <div className="flex w-full flex-col">
      <LandingHero />
      <LandingProviders />
      <LandingWorkspaces />
      <LandingModels />
      <LandingSavings />
      <LandingPricingSection />
      <LandingFaq />
      <LandingFinalCta />
    </div>
  );
}
