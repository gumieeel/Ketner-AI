import { useEffect } from 'react';
import { LandingHero } from './landing/hero';
import { LandingModels } from './landing/models';
import { LandingFeatures } from './landing/features';
import { LandingHowItWorks } from './landing/how-it-works';
import { LandingPricingSection } from './landing/pricing-section';
import { LandingFaq } from './landing/faq';
import { LandingFinalCta } from './landing/final-cta';

export function LandingPage() {
  useEffect(() => {
    if (!window.location.hash) {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  }, []);

  return (
    <div className="flex w-full flex-col items-center text-center">
      <LandingHero />
      <LandingModels />
      <LandingFeatures />
      <LandingHowItWorks />
      <LandingPricingSection />
      <LandingFaq />
      <LandingFinalCta />
    </div>
  );
}
