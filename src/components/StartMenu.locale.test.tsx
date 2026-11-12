/**
 * StartMenu in French (#566 A): the catalog swap reaches the menu through useT,
 * and <html lang> follows. Role / test-id selectors only, so the English-text
 * selectors elsewhere keep working in `en`.
 */
import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import { StartMenu } from './StartMenu';
import { resetI18nForTests, setLocale } from '../i18n/i18n';

afterEach(() => {
  act(() => resetI18nForTests());
});

function renderMenu() {
  return render(
    <StartMenu onStart={() => {}} selectedMapId="glacial" onSelectMap={() => {}} onOpenOptions={() => {}} />,
  );
}

describe('StartMenu — fr', () => {
  it('renders the French catalog, and switches back to English', async () => {
    renderMenu();
    expect(screen.getByRole('button', { name: 'Start Game - Click or Press Enter' })).toBeTruthy();

    await act(() => setLocale('fr'));
    expect(document.documentElement.lang).toBe('fr');

    const start = screen.getByRole('button', { name: 'Lancer la partie - Cliquez ou appuyez sur Entrée' });
    expect(start.textContent).toContain('LANCER');
    expect(screen.getByRole('button', { name: 'Ouvrir les options' }).textContent).toBe('OPTIONS');

    const modes = screen.getByRole('radiogroup', { name: 'Mode de jeu' });
    expect(within(modes).getByRole('radio', { name: 'Carte unique' })).toBeTruthy();

    const maps = screen.getByRole('listbox', { name: 'Choisir une carte' });
    expect(within(maps).getByRole('option', { name: /Source glaciaire/ })).toBeTruthy();

    act(() => resetI18nForTests());
    expect(screen.getByRole('button', { name: 'Open Options' })).toBeTruthy();
  });
});
