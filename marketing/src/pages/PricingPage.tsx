import { Check, ArrowRight } from "lucide-react";

const PricingPage = () => {
  const handleGetStarted = () => {
    window.location.href = import.meta.env.VITE_APP_URL ?? "localhost:3001";
  };

  const plans = [
    {
      name: "Starter",
      price: "$99",
      description: "Perfect for small agencies",
      features: [
        "Up to 5 clients",
        "Basic SEO tracking",
        "Monthly reports",
        "Email support",
        "1 team member",
      ],
    },
    {
      name: "Professional",
      price: "$299",
      description: "Best for growing agencies",
      popular: true,
      features: [
        "Up to 25 clients",
        "Advanced analytics",
        "Weekly reports",
        "Priority support",
        "5 team members",
        "White label reports",
        "API access",
      ],
    },
    {
      name: "Enterprise",
      price: "Custom",
      description: "For large agencies",
      features: [
        "Unlimited clients",
        "Custom integrations",
        "Daily reports",
        "Dedicated support",
        "Unlimited team members",
        "Custom branding",
        "SLA guarantee",
      ],
    },
  ];

  return (
    <div className="min-h-screen">
      <section className="pt-24 pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
              Simple, Transparent Pricing
            </h1>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Choose the perfect plan for your agency. All plans include a
              14-day free trial.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {plans.map((plan, index) => (
              <div
                key={index}
                className={`relative bg-white rounded-2xl border-2 p-8 ${
                  plan.popular
                    ? "border-primary-500 shadow-xl scale-105"
                    : "border-gray-200 hover:border-primary-300"
                } transition-all duration-300`}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                    <span className="bg-primary-600 text-white px-4 py-2 rounded-full text-sm font-semibold">
                      Most Popular
                    </span>
                  </div>
                )}

                <div className="text-center mb-8">
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">
                    {plan.name}
                  </h3>
                  <p className="text-gray-600 mb-4">{plan.description}</p>
                  <div className="text-4xl font-bold text-gray-900">
                    {plan.price}
                    {plan.price !== "Custom" && (
                      <span className="text-lg text-gray-600">/month</span>
                    )}
                  </div>
                </div>

                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature, featureIndex) => (
                    <li
                      key={featureIndex}
                      className="flex items-center space-x-3"
                    >
                      <Check className="h-5 w-5 text-secondary-500" />
                      <span className="text-gray-700">{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={handleGetStarted}
                  className={`w-full py-3 px-6 rounded-lg font-semibold transition-all duration-300 flex items-center justify-center space-x-2 ${
                    plan.popular
                      ? "bg-primary-600 text-white hover:bg-primary-700"
                      : "bg-gray-100 text-gray-900 hover:bg-primary-600 hover:text-white"
                  }`}
                >
                  <span>Get Started</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default PricingPage;
