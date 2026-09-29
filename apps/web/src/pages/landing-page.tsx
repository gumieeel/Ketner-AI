import { LandingHero } from './landing/hero';
import { ModelStrip } from './landing/model-strip';
import { LandingFeatures } from './landing/features';
import { LandingHowItWorks } from './landing/how-it-works';
import { LandingPricingSection } from './landing/pricing-section';
import { LandingFaq } from './landing/faq';
import { LandingFinalCta } from './landing/final-cta';

export function LandingPage() {
  return (
    <div className="flex flex-col items-center w-full gap-16 md:gap-24 animate-fade-in text-center">
      <LandingHero />
      <ModelStrip />
      <LandingFeatures />
      <LandingHowItWorks />
      <LandingPricingSection />
      <LandingFaq />
      <LandingFinalCta />
    </div>
  );
}
