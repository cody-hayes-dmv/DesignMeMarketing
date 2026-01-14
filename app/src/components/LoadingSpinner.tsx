type LoadingSpinnerProps = { text?: string };

const LoadingSpinner = ({ text = "Loading..." }: LoadingSpinnerProps) => {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4" />
        <p className="text-gray-600">{text}</p>
      </div>
    </div>
  );
};

export default LoadingSpinner;
