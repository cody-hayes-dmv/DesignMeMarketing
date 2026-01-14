import { Target, Users, Award, TrendingUp } from "lucide-react";
import teamworkImg from "@/assets/images/teamwork.jpg";

const AboutPage = () => {
  return (
    <div className="min-h-screen">
      <section className="pt-24 pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
              About YourSEODashboard
            </h1>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              We're on a mission to make SEO analytics accessible, actionable,
              and beautiful for agencies of all sizes.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center mb-20">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 mb-6">
                Our Mission
              </h2>
              <p className="text-lg text-gray-600 mb-6 leading-relaxed">
                We believe that powerful SEO analytics shouldn't be complicated
                or expensive. Our platform combines enterprise-grade features
                with an intuitive interface that makes it easy for agencies to
                deliver exceptional results for their clients.
              </p>
              <p className="text-lg text-gray-600 leading-relaxed">
                Founded by SEO professionals who understand the challenges
                agencies face, we've built a platform that solves real problems
                and helps agencies grow their business.
              </p>
            </div>
            <div className="bg-gradient-to-br from-primary-100 to-secondary-100 p-8 rounded-2xl">
              <img
                src={teamworkImg}
                alt="Team collaboration"
                className="w-full h-64 object-cover rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="bg-primary-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Target className="h-8 w-8 text-primary-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Mission Driven
              </h3>
              <p className="text-gray-600">
                Focused on empowering agencies with better tools and insights.
              </p>
            </div>

            <div className="text-center">
              <div className="bg-secondary-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="h-8 w-8 text-secondary-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Customer First
              </h3>
              <p className="text-gray-600">
                Every feature is designed with our users' success in mind.
              </p>
            </div>

            <div className="text-center">
              <div className="bg-accent-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Award className="h-8 w-8 text-accent-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Quality Focus
              </h3>
              <p className="text-gray-600">
                We never compromise on data accuracy or platform reliability.
              </p>
            </div>

            <div className="text-center">
              <div className="bg-primary-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <TrendingUp className="h-8 w-8 text-primary-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Growth Oriented
              </h3>
              <p className="text-gray-600">
                Built to scale with your agency as it grows and evolves.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AboutPage;
