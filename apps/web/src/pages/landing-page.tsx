import { useEffect } from 'react';
import { STAGE_GUTTER } from '@/components/layout/stage';
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
      <div
        id="hero-next"
        className={`mx-auto flex w-full max-w-[1920px] flex-col pb-8 ${STAGE_GUTTER}`}
      >
        <LandingProviders />
        <LandingWorkspaces />
        <LandingModels />
        <LandingSavings />
        <LandingPricingSection />
        <LandingFaq />
        <LandingFinalCta />
      </div>
    </div>
  );
}
