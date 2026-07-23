import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the main menu Start button', () => {
  render(<App />);
  const startButton = screen.getByRole('button', { name: /start/i });
  expect(startButton).toBeInTheDocument();
});
